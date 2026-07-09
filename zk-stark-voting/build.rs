fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    println!("cargo:warning=build.rs: TARGET={:?}, ARCH={:?}", target, arch);

    if target.contains("riscv") || arch.contains("riscv") || std::env::var("SP1_BUILD").is_ok() {
        return;
    }
    sp1_helper::build_program("./program");
}
