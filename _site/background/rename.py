import os
import re

# Directory containing the videos
directory = os.path.dirname(__file__)  # <-- Replace with your directory path

def rename_videos():
    files = os.listdir(directory)
    counter = 1  # Starting number for renaming
    
    for filename in sorted(files):
        if filename.endswith('.mp4'):
            # Create new filename, e.g., 'video_01.mp4'
            new_name = f'video_{counter}.mp4'
            src = os.path.join(directory, filename)
            dst = os.path.join(directory, new_name)
            os.rename(src, dst)
            print(f'Renamed "{filename}" to "{new_name}"')
            counter += 1

if __name__ == '__main__':
    rename_videos()
