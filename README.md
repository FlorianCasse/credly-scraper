# Credly Badge Downloader

A shell script for macOS that downloads all badges from a Credly profile, performs OCR to extract badge names, and processes the images to a standardized format.

## Features

- Downloads all badges from a Credly user profile
- Performs OCR on badge images to extract text
- Automatically renames badges based on OCR results
- Processes images using ImageMagick CLI tools:
  - Resizes images to fit within 512x254 pixels (maintaining aspect ratio)
  - Centers images on a 512x254 transparent canvas
  - Exports as PNG with transparency
- Organizes output into structured directories

## Prerequisites

The script requires the following tools to be installed on macOS:

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required dependencies
brew install jq tesseract imagemagick
```

### Dependency Details

- **curl**: HTTP client (usually pre-installed on macOS)
- **jq**: JSON processor for parsing Credly API responses
- **tesseract**: OCR engine for extracting text from badge images
- **ImageMagick**: Image processing toolkit (replaces GIMP with CLI tools)

## Usage

### Basic Usage

```bash
./credly_badge_downloader.sh <credly-profile-url>
```

### Examples

```bash
# Download badges from a Credly profile
./credly_badge_downloader.sh https://www.credly.com/users/johndoe

# Alternative URL format
./credly_badge_downloader.sh https://www.credly.com/users/johndoe/badges
```

## Output Structure

The script creates a timestamped directory containing:

```
credly_badges_username_20231022_143000/
├── raw/                    # Original downloaded badges (renamed with OCR)
│   ├── 1_AWS_Certified_Solutions_Architect.png
│   ├── 2_Google_Cloud_Professional.png
│   └── ...
├── processed/              # Processed badges (512x254, centered, transparent background)
│   ├── 1_AWS_Certified_Solutions_Architect_processed.png
│   ├── 2_Google_Cloud_Professional_processed.png
│   └── ...
└── metadata/               # JSON metadata for each badge
    ├── all_badges.json
    ├── 1_AWS_Certified_Solutions_Architect.json
    └── ...
```

## Image Processing Details

The script replicates the GIMP workflow using ImageMagick CLI tools:

1. **Resize**: Images are resized to fit within 512x254 pixels while maintaining aspect ratio
2. **Canvas**: Creates a 512x254 pixel canvas with transparent background
3. **Center**: Centers the resized image on the canvas
4. **Export**: Saves as PNG with transparency preserved

This is equivalent to the following ImageMagick command:
```bash
magick input.png -resize 512x254 -background none -gravity center -extent 512x254 output.png
```

## How It Works

1. **Dependency Check**: Verifies all required tools are installed
2. **User Extraction**: Parses the Credly profile URL to extract the username
3. **Badge Fetching**: Queries the Credly API to retrieve all badges
4. **Download**: Downloads each badge image
5. **OCR Processing**: Runs Tesseract OCR to extract text from badge images
6. **Renaming**: Renames files based on OCR results (falls back to badge name if OCR fails)
7. **Image Processing**: Processes images using ImageMagick to standardize dimensions
8. **Metadata**: Saves badge metadata in JSON format

## Error Handling

The script includes comprehensive error handling:

- Validates Credly profile URL format
- Checks for missing dependencies
- Handles API errors gracefully
- Skips badges with missing images
- Falls back to badge names when OCR fails

## Troubleshooting

### "Missing dependencies" error

Install the missing tools using Homebrew:
```bash
brew install jq tesseract imagemagick
```

### "Failed to fetch badges" error

- Verify the Credly profile URL is correct
- Check if the profile is public (private profiles cannot be accessed)
- Ensure you have an internet connection

### OCR not detecting text

- Tesseract works best with clear, high-contrast text
- Some badge designs may not contain extractable text
- The script will fall back to the badge name from Credly's metadata

### ImageMagick errors

Ensure ImageMagick is properly installed:
```bash
magick --version
# or
convert --version
```

## Limitations

- Only works with public Credly profiles
- OCR accuracy depends on badge image quality and text clarity
- Requires active internet connection
- API rate limits may apply for users with many badges

## License

MIT License - Feel free to modify and distribute

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
