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

```powershell
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Restart your terminal, then verify:

```powershell
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
