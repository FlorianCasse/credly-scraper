# Credly Badge Scraper

Give you the ability to list all the certifications within the region. Tool based on Malte Wilhelm work.

Available as both a **web app** and **command-line tool**.

## Web App

**Try it now:** [https://floriancasse.github.io/credly-scraper](https://floriancasse.github.io/credly-scraper)

The web app runs entirely in your browser — no installation required!

> **Note:** The app uses CORS proxies to fetch data from Credly's API since direct browser requests are blocked by CORS policies. The app tries direct requests first, falling back to proxies if needed.

### Features

- **Multiple profiles** — Paste one Credly profile URL per line to scrape several people at once
- **Country quick-select** — One-click checkboxes to load predefined profiles for France, Belgium, and Luxembourg
- **Common Certifications view** — When multiple profiles are loaded, see which certifications are shared across people, sorted by number of holders
- **By Profile view** — Browse all certifications organised per person
- **Keyword filter** — Type a keyword (e.g. VMware, AWS, Azure) to only show matching certifications
- **Date filter** — Only show certifications issued after a given date
- **CSV export** — Download the full list as a CSV file (columns: Profile, Name, Issuer, Issued At, Expires At, Badge URL, Image URL)
- **ZIP download** — Download all badge images at once as a ZIP, organised into per-profile subfolders
- **Individual download** — Download any single badge image directly
- **Customisable dimensions** — Set your own output width and height (default: 512×254 px)
- **Automatic image processing** — Badges are resized and centred on a transparent canvas at your chosen dimensions
- **Display names** — People are shown by their first and last name, not their username
- **100% client-side** — Your data never leaves your browser (except API calls through a CORS proxy)
- **Responsive design** — Works on desktop and mobile

### How to Use

1. Visit the [web app](https://floriancasse.github.io/credly-scraper)
2. Use the country quick-select checkboxes **or** paste Credly profile URLs manually (one per line)
3. Optionally set a keyword filter and/or an "issued after" date
4. Optionally adjust the output dimensions
5. Click **Fetch Badges** (or press **Ctrl+Enter**)
6. Switch between **Common Certifications** and **By Profile** tabs
7. Export as CSV or download images individually / as a ZIP

---

## Command-Line Tool (macOS)

A shell script for macOS that downloads all badges from a Credly profile, performs OCR to extract badge names, and processes the images to a standardised format.

### Features

- Downloads all badges from a Credly user profile
- Performs OCR on badge images to extract text
- Automatically renames badges based on OCR results
- Processes images using ImageMagick CLI tools:
  - Resizes images to fit within 512×254 pixels (maintaining aspect ratio)
  - Centres images on a 512×254 transparent canvas
  - Exports as PNG with transparency
- Organises output into structured directories

### Prerequisites

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
- **ImageMagick**: Image processing toolkit

### Usage

```bash
./credly_badge_downloader.sh <credly-profile-url>
```

**Examples:**

```bash
# Download badges from a Credly profile
./credly_badge_downloader.sh https://www.credly.com/users/johndoe

# Alternative URL format
./credly_badge_downloader.sh https://www.credly.com/users/johndoe/badges
```

### Output Structure

```
credly_badges_username_20231022_143000/
├── raw/                    # Original downloaded badges (renamed with OCR)
│   ├── 1_AWS_Certified_Solutions_Architect.png
│   ├── 2_Google_Cloud_Professional.png
│   └── ...
├── processed/              # Processed badges (512x254, centred, transparent background)
│   ├── 1_AWS_Certified_Solutions_Architect_processed.png
│   ├── 2_Google_Cloud_Professional_processed.png
│   └── ...
└── metadata/               # JSON metadata for each badge
    ├── all_badges.json
    ├── 1_AWS_Certified_Solutions_Architect.json
    └── ...
```

### Image Processing Details

The script replicates the GIMP workflow using ImageMagick CLI tools:

1. **Resize**: Images are resized to fit within 512×254 pixels while maintaining aspect ratio
2. **Canvas**: Creates a 512×254 pixel canvas with transparent background
3. **Center**: Centres the resized image on the canvas
4. **Export**: Saves as PNG with transparency preserved

This is equivalent to the following ImageMagick command:
```bash
magick input.png -resize 512x254 -background none -gravity center -extent 512x254 output.png
```

---

## Limitations

- Only works with public Credly profiles
- OCR accuracy depends on badge image quality and text clarity (CLI tool only)
- Requires active internet connection
- API rate limits may apply for users with many badges

## License

MIT License - Feel free to modify and distribute

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests on [GitHub](https://github.com/FlorianCasse/credly-scraper).
