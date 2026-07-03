# AstraFlow Code Sandbox Template

Builds the `astraflow-code` template from the CodeHatch code-server image.

The template includes:

- code-server on port `8080`
- OpenSSH server and websocat for VS Code Remote SSH over port `8081`
- persistent volume mount target `/workspace`
- Node.js 22, npm, git, gh, jq, tmux, docker.io
- Starship prompt initialized for bash
- Claude Code, Codex, and opencode CLIs
- Claude Code, ChatGPT, opencode, Python, debugpy, ESLint, Prettier, and GitHub PR code-server extensions

Default resources:

- 8 vCPU
- 8192 MiB RAM

## Build

```bash
cd sandbox_template/code
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
UCLOUD_SANDBOX_API_KEY=... \
UCLOUD_SANDBOX_DOMAIN=cn-wlcb.sandbox.ucloudai.com \
UCLOUD_SANDBOX_TEMPLATE_CPU_COUNT=8 \
UCLOUD_SANDBOX_TEMPLATE_MEMORY_MB=8192 \
.venv/bin/python build_template.py
```

Do not include the wildcard prefix in the domain; use
`cn-wlcb.sandbox.ucloudai.com`, not `*.cn-wlcb.sandbox.ucloudai.com`.

Extension installation intentionally runs during the template build with
`--force`, so already-installed extensions are reinstalled or updated. If any
`code-server --install-extension` command fails, the build fails instead of
publishing a partially configured template.

Starship is installed as the final template layer so existing cached layers for
the heavier runtime and extension setup remain reusable.
