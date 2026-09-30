#!/usr/bin/env python3
"""FTS-only life-kb access when node/tsx/better-sqlite3 is unavailable.

search <db> <query> [--category=procedure] [--limit=5] [--format=text|json]
ingest <db> <file>  [--category=procedure] [--source=ai-inferred]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone


def safe_fts(query: str) -> str:
    tokens = re.findall(r"[\w\u4e00-\u9fff]+", query, flags=re.UNICODE)
    return " OR ".join(tokens) if tokens else query.strip()


def search(db_path: str, query: str, category: str | None, limit: int, fmt: str) -> int:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    fts = safe_fts(query)
    sql = """
      SELECT k.id, k.content, k.category, k.source,
             bm25(knowledge_fts) AS rank
      FROM knowledge_fts
      JOIN knowledge k ON k.id = knowledge_fts.id
      WHERE knowledge_fts MATCH ?
    """
    args: list[object] = [fts]
    if category:
        sql += " AND k.category = ?"
        args.append(category)
    sql += " ORDER BY rank LIMIT ?"
    args.append(limit)
    try:
        rows = conn.execute(sql, args).fetchall()
    except sqlite3.OperationalError:
        # MATCH 语法失败时退回 LIKE（仍比静默降级强）
        like = f"%{query[:80]}%"
        rows = conn.execute(
            """
            SELECT id, content, category, source, 0.0 AS rank
            FROM knowledge
            WHERE (? IS NULL OR category = ?) AND content LIKE ?
            ORDER BY updated_at DESC LIMIT ?
            """,
            (category, category, like, limit),
        ).fetchall()

    hits = [
        {
            "id": r["id"],
            "content": r["content"],
            "category": r["category"],
            "score": float(r["rank"] or 0.0),
            "source": r["source"] or "fts-fallback",
        }
        for r in rows
    ]
    if fmt == "json":
        sys.stdout.write(json.dumps(hits, ensure_ascii=False) + "\n")
    elif not hits:
        sys.stdout.write("(no hits)\n")
    else:
        sys.stdout.write(
            "\n".join(f"- [{h['score']:.3f} fts] {h['content']}" for h in hits) + "\n"
        )
    return 0


def ingest(db_path: str, path: str, category: str, source: str) -> int:
    text = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    text = text.strip()
    if not text:
        print("ingest: empty file", file=sys.stderr)
        return 1
    owner = "shared"
    digest = hashlib.sha256(text.encode()).hexdigest()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    conn = sqlite3.connect(db_path)
    existing = conn.execute(
        "SELECT id FROM knowledge WHERE owner = ? AND content_hash = ?",
        (owner, digest),
    ).fetchone()
    kid = existing[0] if existing else str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO knowledge (
          id, owner, content, category, source, is_evergreen, content_hash,
          contributed_by, project_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, 'socai-bug-memory', NULL, ?, ?)
        ON CONFLICT(owner, content_hash) DO UPDATE SET
          content = excluded.content,
          category = excluded.category,
          source = excluded.source,
          updated_at = excluded.updated_at
        """,
        (kid, owner, text, category, source, digest, now, now),
    )
    conn.execute("DELETE FROM knowledge_fts WHERE id = ?", (kid,))
    conn.execute("INSERT INTO knowledge_fts (id, content) VALUES (?, ?)", (kid, text))
    conn.commit()
    sys.stdout.write(json.dumps({"id": kid, "inserted": existing is None}) + "\n")
    return 0


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search")
    s.add_argument("db")
    s.add_argument("query")
    s.add_argument("--category", default="")
    s.add_argument("--limit", type=int, default=5)
    s.add_argument("--format", choices=("text", "json"), default="text")

    i = sub.add_parser("ingest")
    i.add_argument("db")
    i.add_argument("file")
    i.add_argument("--category", default="procedure")
    i.add_argument("--source", default="ai-inferred")

    args = p.parse_args(argv)
    if args.cmd == "search":
        return search(args.db, args.query, args.category or None, args.limit, args.format)
    return ingest(args.db, args.file, args.category, args.source)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
