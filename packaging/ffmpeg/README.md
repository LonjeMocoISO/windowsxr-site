# Windows XR FFmpeg 7.1 encoder recipe

This is a separate command-line encoder, not a library linked into Windows XR.
Only its source archives, recipe, patch and notices are published by this job.
The Windows XR Host and Quest APK are not part of this source artifact.

## Sources

- FFmpeg 7.1 official source archive, unmodified:
  https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz
  SHA-256 `40973d44970dbc83ef302b0609f2e74982be2d85916dd2ee7472d30678a7abe6`.
- Intel oneVPL dispatcher 2.13.0, commit
  `5f6bd8a1e753c8f63a3fd8b36894d6968b808a6d`:
  https://codeload.github.com/intel/libvpl/tar.gz/5f6bd8a1e753c8f63a3fd8b36894d6968b808a6d
  SHA-256 `ad4c5b0e46035568fa43371e99a6267cd00b1e8c58c78d606b9687930f7ca4b9`.

FFmpeg is configured with GPL, nonfree and version3 components disabled and
uses LGPL 2.1 or later. Intel oneVPL is MIT licensed. The only source change
is `onevpl-mingw.patch`, which limits an MSVC-version check to MSVC. Its
equivalent is used by the public BtbN FFmpeg build recipe for oneVPL.

## Rebuild

Use an Ubuntu 24.04 environment with these unmodified distribution tools:

```sh
sudo apt-get update
sudo apt-get install --no-install-recommends \
  gcc-mingw-w64-x86-64-posix g++-mingw-w64-x86-64-posix \
  mingw-w64-tools nasm cmake ninja-build pkg-config curl xz-utils patch
bash packaging/ffmpeg/build.sh
```

The script downloads and verifies the two archives, applies the one portability
patch, statically builds oneVPL, then builds only the FFmpeg command-line
components required for BGRA rawvideo through pipe, NV12 conversion, and
H.264 QSV encoding using a D3D11 child device. The resulting executable must
import only Windows system DLLs, never an external FFmpeg, oneVPL, MinGW or
libgcc runtime DLL. The job fails if those unexpected DLL imports are found.

The output is `dist/ffmpeg-lgpl71/` containing `bin/ffmpeg.exe`, complete
source archives, this exact recipe/patch, notices, build logs/configuration,
compiler package versions, DLL-import evidence and SHA-256 manifest.

Linux build checks cannot validate a real Windows Intel GPU. Before publishing
the encoder in a Windows XR package, validate `ffmpeg.exe -version`, its license,
the exact Host QSV arguments, BGRA-to-NV12 conversion, emitted H.264 access units,
and absence of additional runtime DLL requirements on Windows. A successful
build is not a physical Quest test or a guarantee for every GPU.

Official references:

- https://ffmpeg.org/legal.html
- https://github.com/intel/libvpl/tree/5f6bd8a1e753c8f63a3fd8b36894d6968b808a6d
- https://github.com/BtbN/FFmpeg-Builds/blob/master/scripts.d/50-onevpl.sh
