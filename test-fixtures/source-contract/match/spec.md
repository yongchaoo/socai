risk: low
tags: tauri

contract:
  - kind: tauri-command
    js: js/bridge.ts
    rust: rust/main.rs
  - kind: same-literal
    needle: "[desktop-server] ready"
    files:
      - a/ready.txt
      - b/ready.txt
