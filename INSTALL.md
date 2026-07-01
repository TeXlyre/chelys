# Recipe Requirements

Chelys can run without Docker or Cargo, but individual recipes may need extra tools.

## Docker recipes

Docker-based recipes require Docker to be installed and running.

### Windows

```powershell
winget install --id Docker.DockerDesktop -e
```

### macOS

```bash
brew install --cask docker
```

### Linux

Install Docker using the instructions for your distribution:

https://docs.docker.com/engine/install/

Verify:

```bash
docker --version
```

## System recipes using Cargo

Some system recipes install Rust-based tools with `cargo install`.

### Windows

```cmd
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
rustup toolchain install 1.68.2-x86_64-pc-windows-msvc && rustup default 1.68.2-x86_64-pc-windows-msvc
setx CARGO_REGISTRIES_CRATES_IO_PROTOCOL sparse
```

Restart your terminal, then verify:

```cmd
cargo --version
where link
```

### macOS

```bash
brew install rustup
rustup-init
```

Restart your terminal, then verify:

```bash
cargo --version
```

### Linux

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart your terminal, then verify:

```bash
cargo --version
```
