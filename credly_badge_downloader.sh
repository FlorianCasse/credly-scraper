#!/bin/bash

# Credly Badge Downloader and Processor for macOS
# This script downloads badges from a Credly profile, performs OCR, and processes images

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored messages
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to check if required commands are available
check_dependencies() {
    print_info "Checking dependencies..."

    local missing_deps=()

    if ! command -v curl &> /dev/null; then
        missing_deps+=("curl")
    fi

    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq (install with: brew install jq)")
    fi

    if ! command -v tesseract &> /dev/null; then
        missing_deps+=("tesseract (install with: brew install tesseract)")
    fi

    if ! command -v convert &> /dev/null && ! command -v magick &> /dev/null; then
        missing_deps+=("ImageMagick (install with: brew install imagemagick)")
    fi

    if [ ${#missing_deps[@]} -ne 0 ]; then
        print_error "Missing dependencies:"
        for dep in "${missing_deps[@]}"; do
            echo "  - $dep"
        done
        exit 1
    fi

    print_success "All dependencies are installed"
}

# Function to extract username from Credly profile URL
extract_username() {
    local url="$1"

    # Handle different Credly URL formats
    # https://www.credly.com/users/username
    # https://www.credly.com/users/username/badges
    # https://credly.com/users/username

    if [[ $url =~ credly\.com/users/([^/]+) ]]; then
        echo "${BASH_REMATCH[1]}"
    else
        print_error "Invalid Credly profile URL format"
        echo "Expected format: https://www.credly.com/users/username"
        exit 1
    fi
}

# Function to fetch badges from Credly API
fetch_badges() {
    local username="$1"
    local page=1
    local per_page=100

    print_info "Fetching badges for user: $username" >&2

    # Build a complete JSON array by collecting all pages
    local all_badges_json="[]"

    while true; do
        print_info "Fetching page $page..." >&2

        # Credly API endpoint
        local api_url="https://www.credly.com/users/${username}/badges.json?page=${page}&per_page=${per_page}"

        local response=$(curl -s -H "Accept: application/json" "$api_url")

        # Check if response is valid JSON
        if ! echo "$response" | jq empty 2>/dev/null; then
            if [ $page -eq 1 ]; then
                print_error "Failed to fetch badges. User may not exist or profile is private." >&2
                exit 1
            else
                break
            fi
        fi

        # Extract badges from this page
        local page_badges=$(echo "$response" | jq '.data // []')
        local badge_count=$(echo "$page_badges" | jq 'length')

        if [ "$badge_count" -eq 0 ]; then
            break
        fi

        # Merge with existing badges
        all_badges_json=$(echo "$all_badges_json" "$page_badges" | jq -s '.[0] + .[1]')

        # Check if there are more pages
        local has_more=$(echo "$response" | jq -r '.metadata.has_more // false')
        if [ "$has_more" != "true" ]; then
            break
        fi

        ((page++))
    done

    local total_count=$(echo "$all_badges_json" | jq 'length')
    print_success "Found $total_count badges" >&2

    # Return badges as JSON array
    echo "$all_badges_json"
}

# Function to sanitize filename
sanitize_filename() {
    local filename="$1"
    # Remove or replace invalid characters
    echo "$filename" | sed 's/[^a-zA-Z0-9._-]/_/g' | sed 's/__*/_/g' | sed 's/^_//;s/_$//'
}

# Function to download badge image
download_badge() {
    local image_url="$1"
    local output_file="$2"

    curl -s -L -o "$output_file" "$image_url"

    if [ $? -eq 0 ] && [ -f "$output_file" ]; then
        return 0
    else
        return 1
    fi
}

# Function to perform OCR on badge image
perform_ocr() {
    local image_file="$1"

    # Perform OCR and extract text
    local ocr_text=$(tesseract "$image_file" - 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

    # If OCR text is empty or too short, return empty
    if [ -z "$ocr_text" ] || [ ${#ocr_text} -lt 3 ]; then
        echo ""
    else
        echo "$ocr_text"
    fi
}

# Function to process image (resize and center)
process_image() {
    local input_file="$1"
    local output_file="$2"

    # Target dimensions
    local target_width=512
    local target_height=254

    # Use magick if available, otherwise use convert
    local magick_cmd="convert"
    if command -v magick &> /dev/null; then
        magick_cmd="magick"
    fi

    # Process the image:
    # 1. Resize maintaining aspect ratio to fit within 512x254
    # 2. Extend canvas to 512x254 with transparent background (centered)

    $magick_cmd "$input_file" \
        -resize "${target_width}x${target_height}" \
        -background none \
        -gravity center \
        -extent "${target_width}x${target_height}" \
        "$output_file"

    if [ $? -eq 0 ]; then
        return 0
    else
        return 1
    fi
}

# Function to create output directories
create_output_dirs() {
    local base_dir="$1"

    mkdir -p "$base_dir/raw"
    mkdir -p "$base_dir/processed"
    mkdir -p "$base_dir/metadata"
}

# Main function
main() {
    if [ $# -eq 0 ]; then
        print_error "Usage: $0 <credly-profile-url>"
        echo "Example: $0 https://www.credly.com/users/username"
        exit 1
    fi

    local profile_url="$1"

    print_info "Credly Badge Downloader and Processor"
    echo "========================================="
    echo ""

    # Check dependencies
    check_dependencies
    echo ""

    # Extract username
    local username=$(extract_username "$profile_url")
    print_info "Username: $username"
    echo ""

    # Create output directory
    local output_dir="credly_badges_${username}_$(date +%Y%m%d_%H%M%S)"
    create_output_dirs "$output_dir"
    print_info "Output directory: $output_dir"
    echo ""

    # Fetch badges
    local badges_json=$(fetch_badges "$username")
    local badge_count=$(echo "$badges_json" | jq '. | length')

    if [ "$badge_count" -eq 0 ]; then
        print_warning "No badges found for user: $username"
        exit 0
    fi

    echo ""
    print_info "Processing $badge_count badges..."
    echo ""

    # Save badges metadata
    echo "$badges_json" | jq '.' > "$output_dir/metadata/all_badges.json"

    # Process each badge
    local counter=1
    echo "$badges_json" | jq -c '.[]' | while read -r badge; do
        # Extract badge information
        local badge_name=$(echo "$badge" | jq -r '.badge_template.name // .name // "Unknown Badge"')
        local badge_id=$(echo "$badge" | jq -r '.id // ""')
        local image_url=$(echo "$badge" | jq -r '.image_url // .image.url // ""')
        local issued_at=$(echo "$badge" | jq -r '.issued_at // ""')

        print_info "[$counter/$badge_count] Processing: $badge_name"

        if [ -z "$image_url" ] || [ "$image_url" == "null" ]; then
            print_warning "  No image URL found, skipping..."
            ((counter++))
            continue
        fi

        # Determine file extension from URL
        local ext="png"
        if [[ $image_url =~ \.(jpg|jpeg|png|gif)(\?|$) ]]; then
            ext="${BASH_REMATCH[1]}"
        fi

        # Download raw badge
        local raw_filename="${counter}_${badge_id}.${ext}"
        local raw_filepath="$output_dir/raw/$raw_filename"

        print_info "  Downloading image..."
        if download_badge "$image_url" "$raw_filepath"; then
            print_success "  Downloaded: $raw_filename"
        else
            print_error "  Failed to download image"
            ((counter++))
            continue
        fi

        # Perform OCR
        print_info "  Performing OCR..."
        local ocr_text=$(perform_ocr "$raw_filepath")

        if [ -n "$ocr_text" ]; then
            print_success "  OCR text: $ocr_text"

            # Use OCR text for filename if available
            local sanitized_name=$(sanitize_filename "$ocr_text")
            if [ ${#sanitized_name} -gt 100 ]; then
                sanitized_name="${sanitized_name:0:100}"
            fi
        else
            print_warning "  OCR failed or no text found, using badge name"
            local sanitized_name=$(sanitize_filename "$badge_name")
        fi

        # Rename the raw file
        local new_raw_filename="${counter}_${sanitized_name}.${ext}"
        local new_raw_filepath="$output_dir/raw/$new_raw_filename"
        mv "$raw_filepath" "$new_raw_filepath"
        print_success "  Renamed to: $new_raw_filename"

        # Process image
        print_info "  Processing image (resize and center)..."
        local processed_filename="${counter}_${sanitized_name}_processed.png"
        local processed_filepath="$output_dir/processed/$processed_filename"

        if process_image "$new_raw_filepath" "$processed_filepath"; then
            print_success "  Processed: $processed_filename"
        else
            print_error "  Failed to process image"
        fi

        # Save individual badge metadata
        echo "$badge" | jq --arg ocr "$ocr_text" '. + {ocr_text: $ocr}' > "$output_dir/metadata/${counter}_${sanitized_name}.json"

        echo ""
        ((counter++))
    done

    print_success "All badges processed successfully!"
    print_info "Output directory: $output_dir"
    echo "  - raw/       : Original downloaded badges (renamed with OCR)"
    echo "  - processed/ : Processed badges (512x254, centered)"
    echo "  - metadata/  : JSON metadata for each badge"
}

# Run main function
main "$@"
