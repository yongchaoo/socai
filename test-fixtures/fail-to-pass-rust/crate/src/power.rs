pub fn pow2(n: i64) -> i64 {
    n * n
}

#[cfg(test)]
mod tests {
    #[test]
    fn pow2_works() {
        assert_eq!(super::pow2(3), 9);
    }
}
