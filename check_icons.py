#!/usr/bin/env python3
"""
Script to check and fix achievement icons on production server
Run this script after git pull to ensure all icons are properly deployed
"""

import os
import sys
from pathlib import Path

def check_icons():
    """Check if all achievement icons exist and have correct permissions"""
    
    # Required icons based on database
    required_icons = [
        'clown.svg',
        'dead.svg', 
        'devil.svg',
        'speed.svg',
        'superfat.svg',
        'fat.svg',
        'skeleton.svg',
        'sleep.svg',
        'superspeed.svg',
        'supertourist.svg',
        'tourist.svg'
    ]
    
    icons_dir = Path('static/icons/euc_man_pack')
    
    print(f"Checking icons directory: {icons_dir.absolute()}")
    
    # Check if directory exists
    if not icons_dir.exists():
        print(f"❌ Icons directory does not exist: {icons_dir}")
        print("Create the directory and copy icon files from repository")
        return False
    
    print(f"✓ Icons directory exists")
    
    # Check each required icon
    missing_icons = []
    permission_issues = []
    
    for icon in required_icons:
        icon_path = icons_dir / icon
        
        if not icon_path.exists():
            missing_icons.append(icon)
            print(f"❌ Missing: {icon}")
        else:
            # Check permissions
            stat = icon_path.stat()
            permissions = oct(stat.st_mode)[-3:]
            
            if permissions not in ['644', '664', '755']:
                permission_issues.append(icon)
                print(f"⚠️  Permission issue: {icon} ({permissions})")
            else:
                print(f"✓ OK: {icon}")
    
    # Summary
    print(f"\nSummary:")
    print(f"✓ Found: {len(required_icons) - len(missing_icons)}/{len(required_icons)} icons")
    
    if missing_icons:
        print(f"❌ Missing icons: {', '.join(missing_icons)}")
        
    if permission_issues:
        print(f"⚠️  Permission issues: {', '.join(permission_issues)}")
        print("Run: chmod 644 static/icons/euc_man_pack/*.svg")
    
    return len(missing_icons) == 0 and len(permission_issues) == 0

def fix_permissions():
    """Fix permissions for all icon files"""
    icons_dir = Path('static/icons/euc_man_pack')
    
    if not icons_dir.exists():
        print("Icons directory does not exist")
        return False
    
    try:
        for icon_file in icons_dir.glob('*.svg'):
            icon_file.chmod(0o644)
            print(f"Fixed permissions for: {icon_file.name}")
        return True
    except Exception as e:
        print(f"Error fixing permissions: {e}")
        return False

if __name__ == "__main__":
    print("🔍 Checking achievement icons...")
    
    if len(sys.argv) > 1 and sys.argv[1] == '--fix-permissions':
        print("🔧 Fixing permissions...")
        if fix_permissions():
            print("✓ Permissions fixed")
        else:
            print("❌ Failed to fix permissions")
    
    success = check_icons()
    
    if success:
        print("\n✅ All icons are properly configured!")
    else:
        print("\n❌ Some icons need attention")
        print("\nTo fix:")
        print("1. Ensure all icon files are copied to static/icons/euc_man_pack/")
        print("2. Run: python check_icons.py --fix-permissions")
        print("3. Or manually: chmod 644 static/icons/euc_man_pack/*.svg")
    
    sys.exit(0 if success else 1)