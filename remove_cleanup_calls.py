#!/usr/bin/env python3
"""Remove all .cleanup().await.expect() calls from test files."""

import re
from pathlib import Path

def remove_cleanup_calls(filepath):
    """Remove cleanup calls from test file."""
    content = filepath.read_text()
    original = content
    
    # Pattern: .cleanup()\n.await\n.expect(...)
    # This appears across multiple lines
    pattern = r'test_db\s*\n\s*\.cleanup\(\)\s*\n\s*\.await\s*\n\s*\.expect\([^)]+\);?\s*\n'
    content = re.sub(pattern, '', content)
    
    # Also handle single-line versions: test_db.cleanup().await.expect(...)
    pattern2 = r'test_db\.cleanup\(\)\.await\.expect\([^)]+\);\s*\n'
    content = re.sub(pattern2, '', content)
    
    if content != original:
        filepath.write_text(content)
        return True
    return False

def main():
    """Main entry point."""
    test_dir = Path(__file__).parent / "tests" / "integration"
    
    if not test_dir.exists():
        print(f"Error: {test_dir} does not exist")
        return
    
    updated = []
    for filepath in test_dir.glob("*.rs"):
        if filepath.name == "helpers.rs" or filepath.name == "mod.rs":
            continue
        
        if remove_cleanup_calls(filepath):
            updated.append(filepath.name)
            print(f"✓ {filepath.name}")
        else:
            print(f"- {filepath.name}")
    
    print(f"\nUpdated {len(updated)} files")

if __name__ == "__main__":
    main()
