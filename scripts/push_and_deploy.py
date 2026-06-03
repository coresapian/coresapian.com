#!/usr/bin/env python3
"""
Push coresapian.com to GitHub and deploy to Proxmox.

Usage:
    python3 scripts/push_and_deploy.py          # push + deploy
    python3 scripts/push_and_deploy.py --push-only
    python3 scripts/push_and_deploy.py --deploy-only
    python3 scripts/push_and_deploy.py --skip-lfs  # skip LFS upload, push source only

Handles:
  - Large LFS objects (1.3GB+) with progress reporting
  - Proxmox deployment via SSH -> pct push
  - Service restarts on the LXC
"""

import argparse
import subprocess
import sys
import time
import os

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REMOTE = "org"
BRANCH = "main"
LXC_IP = "192.168.0.148"
PROXMOX_HOST = "root@192.168.0.10"
CT_ID = "103"
WWW_DIR = "/var/www/coresapian/game"


def run(cmd, cwd=None, timeout=None):
    """Run a command, stream output, return (exit_code, output)."""
    print(f"  $ {cmd}")
    proc = subprocess.Popen(
        cmd, shell=True, cwd=cwd or REPO_DIR,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )
    output_lines = []
    last_print = 0
    try:
        for line in proc.stdout:
            output_lines.append(line.rstrip())
            # Print progress every 5 seconds at most
            now = time.time()
            if now - last_print >= 5 or not line.strip():
                print(f"    {line.rstrip()}")
                last_print = now
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        print("  TIMEOUT - killed")
        return -1, "".join(output_lines)
    return proc.returncode, "".join(output_lines)


def git_push(skip_lfs=False):
    """Push to GitHub."""
    print("\n=== GIT PUSH ===")
    os.chdir(REPO_DIR)

    # Show what we're pushing
    rc, out = run(f"git log --oneline {REMOTE}/{BRANCH}..{BRANCH} 2>/dev/null | head -30")
    if rc == 0 and out.strip():
        count = len(out.strip().split("\n"))
        print(f"\n  {count} commits to push:")
        for line in out.strip().split("\n")[:5]:
            print(f"    {line}")
        if count > 5:
            print(f"    ... and {count - 5} more")
    else:
        print("  Checking diff against remote...")
        rc, out = run(f"git diff --stat {REMOTE}/{BRANCH}..{BRANCH} 2>/dev/null")

    if skip_lfs:
        print("\n  Skipping LFS upload (GIT_LFS_SKIP_PUSH=1)")
        env = os.environ.copy()
        env["GIT_LFS_SKIP_PUSH"] = "1"
        cmd = f"git push {REMOTE} {BRANCH}"
        proc = subprocess.Popen(
            cmd, shell=True, cwd=REPO_DIR, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
    else:
        cmd = f"git push {REMOTE} {BRANCH}"
        proc = subprocess.Popen(
            cmd, shell=True, cwd=REPO_DIR,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )

    print(f"\n  Pushing to {REMOTE}/{BRANCH}...")
    print("  (this may take a while with large LFS objects)")

    last_print = 0
    output_lines = []
    start = time.time()
    try:
        for line in proc.stdout:
            output_lines.append(line.rstrip())
            now = time.time()
            elapsed = int(now - start)
            if now - last_print >= 10 or "error" in line.lower() or "done" in line.lower():
                print(f"    [{elapsed:4d}s] {line.rstrip()}")
                last_print = now
        proc.wait()
    except KeyboardInterrupt:
        proc.kill()
        print("\n  Interrupted - killed push")
        return False

    elapsed = int(time.time() - start)
    if proc.returncode == 0:
        print(f"\n  PUSH OK ({elapsed}s)")
        return True
    else:
        print(f"\n  PUSH FAILED (exit {proc.returncode}, {elapsed}s)")
        for line in output_lines[-10:]:
            print(f"    {line}")
        return False


def deploy():
    """Deploy latest build to Proxmox LXC."""
    print("\n=== DEPLOY TO PROXMOX ===")
    os.chdir(REPO_DIR)

    game_dir = os.path.join(REPO_DIR, "public", "game")
    if not os.path.exists(os.path.join(game_dir, "index.pck")):
        print("  ERROR: No game build found. Run export_godot_web.sh first.")
        return False

    # Package
    tar_path = "/tmp/coresapian-game-export.tar.gz"
    print("\n  Packaging game build...")
    rc, _ = run(f"tar czf {tar_path} .", cwd=game_dir)
    if rc != 0:
        print("  FAILED to create tarball")
        return False

    size_mb = os.path.getsize(tar_path) / (1024 * 1024)
    print(f"  Tarball: {size_mb:.1f} MB")

    # Upload to Proxmox host
    print(f"\n  Uploading to {PROXMOX_HOST}...")
    start = time.time()
    rc, _ = run(f"scp {tar_path} {PROXMOX_HOST}:/tmp/coresapian-game-export.tar.gz", timeout=300)
    if rc != 0:
        print("  FAILED to upload to Proxmox host")
        return False
    print(f"  Uploaded ({int(time.time() - start)}s)")

    # Push into LXC
    print(f"\n  Pushing into LXC {CT_ID}...")
    rc, _ = run(f"ssh {PROXMOX_HOST} 'pct push {CT_ID} /tmp/coresapian-game-export.tar.gz /tmp/coresapian-game-export.tar.gz'")
    if rc != 0:
        print("  FAILED to push into LXC")
        return False

    # Extract on LXC
    print(f"\n  Extracting on LXC...")
    rc, _ = run(f'ssh root@{LXC_IP} "cd {WWW_DIR} && tar xzf /tmp/coresapian-game-export.tar.gz"')
    if rc != 0:
        print("  FAILED to extract")
        return False

    # Inject runtime config
    print(f"\n  Injecting runtime config into index.html...")
    rc, _ = run(
        f'ssh root@{LXC_IP} "'
        f'sed -i \'s/__PLAYER_NAME__/Player/g; '
        f's/__SERVER_IP__/coresapian.com/g; '
        f's/__SERVER_PORT__/443/g\' '
        f'{WWW_DIR}/index.html"'
    )

    # Get API key from the world-chat service and inject it
    print(f"  Injecting World Chat API key...")
    rc, out = run(f'ssh root@{LXC_IP} "grep -oP \'CORE_CHAT_API_KEYS=\\K.*\' /etc/systemd/system/coresapian-world-chat.service"')
    api_key = out.strip() if rc == 0 else ""
    if api_key:
        rc, _ = run(f'ssh root@{LXC_IP} "sed -i \'s/__WORLD_CHAT_API_KEY__/{api_key}/\' {WWW_DIR}/index.html"')
    else:
        print("  WARNING: Could not find API key")

    # Verify
    print(f"\n  Verifying deployment...")
    rc, out = run(f'ssh root@{LXC_IP} "ls -lh {WWW_DIR}/index.pck {WWW_DIR}/index.js"')
    if rc == 0:
        print(f"    {out.strip()}")

    # Reload nginx to bust any caches
    run(f'ssh root@{LXC_IP} "systemctl reload nginx"')

    print(f"\n  DEPLOY OK")
    return True


def main():
    parser = argparse.ArgumentParser(description="Push and deploy coresapian.com")
    parser.add_argument("--push-only", action="store_true", help="Only push to GitHub")
    parser.add_argument("--deploy-only", action="store_true", help="Only deploy to Proxmox")
    parser.add_argument("--skip-lfs", action="store_true", help="Skip LFS upload")
    args = parser.parse_args()

    print(f"Repository: {REPO_DIR}")
    print(f"Remote: {REMOTE} ({BRANCH})")
    print(f"LXC: {LXC_IP} ({WWW_DIR})")

    ok = True
    if not args.deploy_only:
        ok = git_push(skip_lfs=args.skip_lfs)
        if not ok:
            print("\nPush failed. Aborting deploy.")
            sys.exit(1)

    if not args.push_only:
        ok = deploy()

    if ok:
        print("\n=== ALL DONE ===")
    else:
        print("\n=== FAILED ===")
        sys.exit(1)


if __name__ == "__main__":
    main()
