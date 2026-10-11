"""Block commits that contain secrets or secret files.

Runs from .githooks/pre-commit on the staged changes (enable once per clone:
`git config core.hooksPath .githooks`). CI runs the fuller gitleaks scan
(.github/workflows/secrets.yml). If a match is a false positive, fix the
pattern here rather than bypassing the hook.
"""
import re
import subprocess
import sys

# Files that must never be committed, whatever their content.
FORBIDDEN_FILES = [
    r"(^|/)\.env$",
    r"(^|/)\.env\.(?!example$)[^/]+$",
    r"(^|/)backend\.env$",
    r"firebase-admin[^/]*\.json$",
    r"service-account[^/]*\.json$",
    r"\.(pem|key|p8|p12|jks|keystore)$",
    r"(^|/)(gs_deploy|gs_admin|id_rsa|id_ed25519)$",
]

# Content patterns (added lines only).
PATTERNS = {
    "private key": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    "AWS access key id": r"\b(AKIA|ASIA)[0-9A-Z]{16}\b",
    "AWS secret key": r"(?i)aws_secret_access_key\s*[=:]\s*['\"]?[A-Za-z0-9/+]{40}",
    "Razorpay key": r"rzp_(live|test)_(?!placeholder\b)[A-Za-z0-9]{10,}",
    "Google API key": r"AIza[0-9A-Za-z_\-]{35}",
    "MongoDB URI with password": r"mongodb(\+srv)?://[^:\s/@]+:(?!PASSWORD@|<db_password>@|REALPASSWORD@|password@)[^@\s<>]+@",
    "GitHub token": r"\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}",
    "JWT secret value": r"^\s*JWT_SECRET_KEY\s*=\s*\S{16,}",
    "Razorpay secret value": r"^\s*RAZORPAY_(KEY_SECRET|WEBHOOK_SECRET)\s*=\s*\S{8,}",
}

# Firebase client configs are bundled into the app by design.
ALLOWED_FILES = [
    r"^frontend/google-services\.json$",
    r"^frontend/credentials/google-services\.json$",
    r"^frontend/GoogleService-Info\.plist$",
    r"^\.githooks/check_secrets\.py$",
    r"^\.gitleaks\.toml$",
]


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace").stdout


def main():
    problems = []
    staged = [f for f in git("diff", "--cached", "--name-only", "--diff-filter=ACMR").splitlines() if f]
    for path in staged:
        if any(re.search(p, path) for p in ALLOWED_FILES):
            continue
        if any(re.search(p, path) for p in FORBIDDEN_FILES):
            problems.append(f"{path}: secret file must not be committed")
            continue
        diff = git("diff", "--cached", "-U0", "--no-color", "--", path)
        for line in diff.splitlines():
            if not line.startswith("+") or line.startswith("+++"):
                continue
            for name, pattern in PATTERNS.items():
                if re.search(pattern, line[1:]):
                    problems.append(f"{path}: looks like a {name}")
                    break
    if problems:
        print("Commit blocked - possible secrets (values not shown):", file=sys.stderr)
        for p in sorted(set(problems)):
            print("  - " + p, file=sys.stderr)
        print("Move the value to an ignored .env / the server's backend.env / GitHub secrets.",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
