#!/usr/bin/env python3
"""Copy a named profile into a trusted project, dry-run by default.

Examples:
    python scripts/apply-profile.py laravel-app /path/to/apps/admin
    python scripts/apply-profile.py laravel-app /path/to/apps/admin --apply
"""
import argparse
from datetime import datetime
from pathlib import Path
import shutil

REPO = Path(__file__).resolve().parent.parent
PROFILES = REPO / 'profiles'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile', choices=sorted(p.name for p in PROFILES.iterdir() if p.is_dir()))
    parser.add_argument('destination', type=Path, help='Trusted existing project/app root')
    parser.add_argument('--apply', action='store_true', help='Write files (otherwise preview only)')
    parser.add_argument('--replace', action='store_true', help='Back up and overwrite existing files')
    args = parser.parse_args()
    if args.replace and not args.apply:
        parser.error('--replace requires --apply')
    project = args.destination.expanduser().resolve()
    if not project.is_dir():
        parser.error(f'Existing project directory required: {project}')
    if project == REPO:
        parser.error('Do not apply project profiles onto this configuration repository itself')
    source = PROFILES / args.profile
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    for item in sorted(source.rglob('*')):
        if not item.is_file():
            continue
        dest = project / item.relative_to(source)
        if dest.exists() and not args.replace:
            print(f'SKIP  {dest} (exists)')
            continue
        if not args.apply:
            print(f'PLAN  {item.relative_to(REPO)} -> {dest}')
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            backup = dest.with_name(dest.name + '.backup-' + timestamp)
            shutil.copy2(dest, backup)
            print(f'BACKUP {backup}')
        shutil.copy2(item, dest)
        print(f'COPY  {dest}')
    if not args.apply:
        print('Dry-run complete: re-run with --apply after reviewing file destinations.')

if __name__ == '__main__':
    main()
