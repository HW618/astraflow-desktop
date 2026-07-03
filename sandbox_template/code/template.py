from ucloud_sandbox import Template


CODE_SERVER_EXTENSIONS = [
    "Anthropic.claude-code",
    "openai.chatgpt",
    "sst-dev.opencode",
    "ms-python.python",
    "ms-python.debugpy",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "GitHub.vscode-pull-request-github",
]


def install_extensions_command() -> str:
    return " && ".join(
        f"code-server --install-extension {extension} --force"
        for extension in CODE_SERVER_EXTENSIONS
    )


def install_starship_command() -> str:
    starship_init = (
        "if command -v starship >/dev/null 2>&1; then\\n"
        '  eval "$(starship init bash)"\\n'
        "fi\\n"
    )

    return (
        "curl -fsSL https://starship.rs/install.sh | sh -s -- -y && "
        "starship --version && "
        f"printf '%b' '{starship_init}' > /etc/profile.d/starship.sh && "
        "chmod 644 /etc/profile.d/starship.sh && "
        "(grep -q 'starship init bash' /etc/bash.bashrc || "
        f"printf '\\n# Starship prompt\\n%b' '{starship_init}' >> /etc/bash.bashrc"
        ")"
    )


template = (
    Template()
    .from_image("uhub.service.ucloud.cn/clientfzzf/sandbox-vscode:v0.5")
    .set_user("root")
    .run_cmd(
        "apt-get update && "
        "apt-get install -y --no-install-recommends "
        "ca-certificates curl docker.io git gnupg jq openssh-server tmux && "
        "rm -rf /var/lib/apt/lists/*"
    )
    .run_cmd(
        "curl -fsSL -o /usr/local/bin/websocat "
        "https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl && "
        "chmod a+x /usr/local/bin/websocat && "
        "websocat --version"
    )
    .run_cmd(
        "mkdir -p -m 755 /etc/apt/keyrings && "
        "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg "
        "-o /etc/apt/keyrings/githubcli-archive-keyring.gpg && "
        "chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && "
        "echo \"deb [arch=$(dpkg --print-architecture) "
        "signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] "
        "https://cli.github.com/packages stable main\" "
        "> /etc/apt/sources.list.d/github-cli.list && "
        "apt-get update && "
        "apt-get install -y --no-install-recommends gh && "
        "rm -rf /var/lib/apt/lists/*"
    )
    .run_cmd(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && "
        "apt-get update && "
        "apt-get install -y --no-install-recommends nodejs && "
        "node --version && npm --version && "
        "rm -rf /var/lib/apt/lists/*"
    )
    .run_cmd(
        "npm install -g "
        "@anthropic-ai/claude-code "
        "@openai/codex "
        "opencode-ai"
    )
    .run_cmd("command -v code-server && code-server --version")
    .run_cmd(install_extensions_command())
    .run_cmd(
        "rm -rf "
        "/root/.claude/history.jsonl "
        "/root/.codex/history.jsonl "
        "/root/.codex/sessions"
    )
    .run_cmd(install_starship_command())
)
