# Python Development Setup

## For Collaborative Development

This project uses a Python virtual environment to ensure consistent dependencies across all developers.

## Setup Instructions for New Developers

### 1. Clone the repository
```bash
git clone https://github.com/hellothatsmoa/cooly-ai.git
cd cooly-ai-main
```

### 2. Create and activate virtual environment
```bash
# Create virtual environment
python3 -m venv .venv

# Activate it (macOS/Linux)
source .venv/bin/activate

# Activate it (Windows)
.venv\Scripts\activate
```

### 3. Install dependencies
```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Verify setup
```bash
python script/test_byteplus_tts.py
```

## Daily Usage

**Always activate the virtual environment before working:**
```bash
source .venv/bin/activate
```

You'll see `(.venv)` in your terminal prompt when active.

**To deactivate:**
```bash
deactivate
```

## Adding New Dependencies

When adding new Python packages:
```bash
pip install package_name
pip freeze > requirements.txt  # Update requirements file
git add requirements.txt       # Commit the change
```

## Benefits

- ✅ Isolated Python environment per project
- ✅ Consistent package versions across developers
- ✅ No conflicts with system Python packages
- ✅ Easy to recreate exact environment
- ✅ Protected from system updates breaking dependencies

## Current Dependencies

- **requests**: HTTP library for API calls
- **python-dotenv**: Load environment variables from .env file
- **certifi, charset-normalizer, idna, urllib3**: requests dependencies
