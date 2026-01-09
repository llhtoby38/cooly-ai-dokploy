# GitHub SSH Setup and Workflow Guide

This guide covers setting up SSH keys for multiple GitHub accounts and the complete workflow for contributing to the cooly-ai repository.

## Overview

When working with multiple GitHub accounts, SSH keys help maintain account separation and avoid authentication conflicts. This guide walks through:

1. Generating SSH keys for a new account
2. Configuring SSH for account separation
3. Setting up Git identity
4. Pulling from main and pushing feature branches
5. Creating pull requests

## Prerequisites

- Windows PowerShell
- Access to multiple GitHub accounts
- Git installed locally

## Step-by-Step Setup

### 1. Generate SSH Key for New Account

```powershell
# Create .ssh folder if it doesn't exist
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh"

# Generate new SSH key
ssh-keygen -t ed25519 -C "your-new-email@example.com" -f "$env:USERPROFILE\.ssh\id_ed25519_new"
# Press Enter twice for no passphrase, or set one if desired
```

### 2. Add SSH Key to GitHub

```powershell
# Copy public key to clipboard
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_new.pub" | Set-Clipboard
```

**GitHub Steps:**
1. Go to GitHub → Settings → SSH and GPG keys
2. Click "New SSH key"
3. Title: `Windows-PC-2025` (or any descriptive name)
4. Key: Paste the copied content (starts with `ssh-ed25519`)
5. Click "Add SSH key"

### 3. Create SSH Config for Account Separation

```powershell
# Create/edit SSH config
notepad "$env:USERPROFILE\.ssh\config"
```

Add this content to the config file:
```ssh
Host github-new
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_new
  IdentitiesOnly yes
```

**Important:** Save the file as `config` (not `config.txt`) to ensure SSH recognizes it.

### 4. Fix SSH Config Permissions

Windows requires specific permissions for SSH files:

```powershell
$ssh = "$env:USERPROFILE\.ssh"
$me = $env:USERNAME

# Fix permissions on config and keys
icacls "$ssh\config" /inheritance:r
icacls "$ssh\config" /grant:r "$($me):(F)"
icacls "$ssh\config" /remove "Everyone" "BUILTIN\Users" "Users" "NT AUTHORITY\Authenticated Users" "Public" "USER-PC\Public"

icacls "$ssh\id_ed25519_new" /inheritance:r
icacls "$ssh\id_ed25519_new" /grant:r "$($me):(R)"
icacls "$ssh\id_ed25519_new.pub" /inheritance:r
icacls "$ssh\id_ed25519_new.pub" /grant:r "$($me):(R)"
```

### 5. Test SSH Connection

```powershell
ssh -T git@github-new
```

- Type "yes" when prompted about host authenticity
- Should see: "Hi [your-username]! You've successfully authenticated..."

## Git Workflow Setup

### 6. Set Up Git Identity for New Account

```powershell
cd E:\Coding\cooly-ai-main\cooly-ai-main

# Set Git identity to match your new GitHub account
git config user.name "your-github-username"
git config user.email "your-new-email@example.com"

# Verify the settings
git config user.name
git config user.email
```

### 7. Trust Directory and Set Remote

```powershell
# Trust the directory (fixes "dubious ownership" error)
git config --global --add safe.directory E:/Coding/cooly-ai-main/cooly-ai-main

# Set remote to use your SSH alias
git remote get-url origin 2>$null && git remote set-url origin git@github-new:cooly-ai/cooly-ai.git || git remote add origin git@github-new:cooly-ai/cooly-ai.git
```

### 8. Pull Latest Main and Create Feature Branch

```powershell
# Get latest from remote
git fetch origin

# Create/switch to main branch tracking remote
git switch -c main --track origin/main 2>$null
git switch main
git pull --ff-only

# Create feature branch
git switch -c feature/your-feature-name
```

## Daily Workflow

### 9. Make Changes, Commit, and Push

```powershell
# Make your changes (edit files in your IDE)
# Then stage and commit
git add -A
git commit -m "feat: describe your changes"

# Push to your feature branch
git push -u origin feature/your-feature-name
```

### 10. Create Pull Request

1. Go to: `https://github.com/cooly-ai/cooly-ai/compare/main...feature/your-feature-name`
2. Click "Create pull request"
3. Add descriptive title and description
4. Click "Create pull request"

## Troubleshooting

### Common Issues

**"Bad permissions" error:**
- Re-run the icacls commands in step 4
- Ensure config file is named `config` not `config.txt`

**"dubious ownership" error:**
- Run: `git config --global --add safe.directory E:/Coding/cooly-ai-main/cooly-ai-main`

**Vercel deployment permission error:**
- Ensure Git identity matches your Vercel team account
- Use `git commit --amend --author="Team Name <team-email@example.com>"` to fix existing commits

**"Could not resolve hostname github-new":**
- Check SSH config file exists and is named `config`
- Verify the Host block is properly formatted

### Verification Commands

```powershell
# Check SSH config
Get-Content "$env:USERPROFILE\.ssh\config"

# Test SSH connection
ssh -T git@github-new

# Check Git identity
git config user.name
git config user.email

# Check remote URL
git remote -v
```

## Key Benefits

1. **Account Separation**: SSH aliases prevent account conflicts
2. **Security**: Proper permissions protect SSH keys
3. **Automation**: Correct Git identity prevents deployment issues
4. **Flexibility**: Easy to switch between accounts

## Best Practices

1. Use descriptive SSH key names (e.g., `id_ed25519_work`, `id_ed25519_personal`)
2. Always test SSH connections after setup
3. Keep Git identity consistent with your GitHub account
4. Use meaningful commit messages
5. Create feature branches for all changes

## Additional Resources

- [GitHub SSH Documentation](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)
- [Vercel Deployment Troubleshooting](https://vercel.com/docs/deployments/troubleshoot-project-collaboration)
- [Git Configuration Guide](https://git-scm.com/book/en/v2/Customizing-Git-Git-Configuration)

---

*This guide was created based on successful setup and testing with the cooly-ai repository workflow.*
