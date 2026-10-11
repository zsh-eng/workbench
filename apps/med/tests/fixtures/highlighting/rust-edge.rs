fn edge() -> Result<Arc<[u32; 3]>, Error> {
    let raw = r#"quote " inside"#;
    let bytes = b"\x7f\n";
    let x = 1f128 + 1e-4931f128 + 0x_FF_u8 as f64;
    unsafe { panicking::r#try(f) }
    let closure = |a: &mut i32| -> i32 { *a += 1; *a };
    /* outer /* nested */ still comment */
    macro_rules! twice { ($e:expr) => { $e * 2 }; }
    Ok(Arc::new([1, 2, 3]))
}
