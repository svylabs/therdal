# SP1 Toolchain & Environment Setup Guide

This document describes how to set up the Succinct SP1 zkVM toolchain and compiler environment required to compile guest programs to the RISC-V target and run proofs using the `sp1-sdk`.

---

## Prerequisites

1. **Rust & Cargo**: Make sure you have a modern Rust version installed (e.g., `rustc 1.93.0+` or `1.96.1+` supporting Edition 2024).
2. **Unix Environment**: A macOS or Linux system with `curl`, `git`, and shell configurations (`bash` or `zsh`).

---

## 1. Install the SP1 Toolchain Manager (`sp1up`)

`sp1up` is the installer and updater for the SP1 toolchain.

Run the following command to download and install `sp1up`:
```bash
curl -L https://sp1up.succinct.xyz | bash
```

This will download `sp1up` and place it in your local directory at `~/.sp1/bin/sp1up`.

---

## 2. Install the SP1 Compiler Toolchain

To install the actual compiler command-line utilities (`cargo-prove`) and link the bare-metal RISC-V target (`succinct` toolchain) to your system's `rustup`, run:
```bash
~/.sp1/bin/sp1up
# Or if PATH is configured:
sp1up
```

During installation, `sp1up` will:
- Download the matching version of the `cargo-prove` command-line utility.
- Pull down the toolchain components.
- Register and link a local rustup toolchain named `succinct` (often pointing to a specific compatible `1.81.0-dev` or newer toolchain).

---

## 3. Configure the PATH Environment Variable

To allow `sp1-helper` (the build script crate) to discover and run `cargo-prove` automatically on compilation, you must add `~/.sp1/bin` to your environment path.

Add the following line to your shell profile file (e.g., `~/.bashrc`, `~/.zshrc`, or `~/.bash_profile`):
```bash
export PATH="$HOME/.sp1/bin:$PATH"
```

Then, reload your terminal session:
```bash
source ~/.zshrc # or source ~/.bashrc
```

Verify that the path is active and it resolves the command:
```bash
which cargo-prove
# Should output: /Users/YOUR_USER/.sp1/bin/cargo-prove
```

---

## 4. Platform-Specific Setup for Proving

When you instantiate the `ProverClient::new()`, it decides which prover backend to use based on your hardware and environment configurations:

1. **Mock / Simulation Mode (Default)**:
   Runs the execution in-memory without compiling cryptographic proofs. Ideal for rapid development.
2. **Local Proving (CPU / GPU)**:
   If generating actual proofs locally:
   - For GPU acceleration (requires Linux + CUDA installed), run with `cargo run --features cuda`.
   - Local CPU proving is single-threaded or multi-threaded based on Rayon configuration, but can be highly memory-intensive (requires 32GB+ RAM depending on circuit size).
3. **Prover Network**:
   To generate proofs in the cloud via the Succinct Prover Network:
   - Obtain an API key from the Succinct Platform.
   - Configure the environment variable:
     ```bash
     export SP1_PROVER=network
     export SP1_PRIVATE_KEY="your_api_key_here"
     ```
