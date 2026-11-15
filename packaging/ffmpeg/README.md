# Windows XR FFmpeg 7.1 encoder recipe

This is a separate command-line encoder, not a library linked into Windows XR.
Only its source archives, recipe, patch and notices are published by this job.
The Windows XR Host and Quest APK are not part of this source artifact.

## Sources

- FFmpeg 7.1 official source archive:
  https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz
  SHA-256 `40973d44970dbc83ef302b0609f2e74982be2d85916dd2ee7472d30678a7abe6`.
- Intel oneVPL dispatcher 2.13.0, commit
  `5f6bd8a1e753c8f63a3fd8b36894d6968b808a6d`:
  https://codeload.github.com/intel/libvpl/tar.gz/5f6bd8a1e753c8f63a3fd8b36894d6968b808a6d
  SHA-256 `ad4c5b0e46035568fa43371e99a6267cd00b1e8c58c78d606b9687930f7ca4b9`.
- AMD AMF 1.4.35 headers and LICENSE.txt from upstream commit
  `ba07d1b3c7c7ee0d846125cffc1d6d78a020c45a`:
  https://github.com/GPUOpen-LibrariesAndSDKs/AMF/tree/ba07d1b3c7c7ee0d846125cffc1d6d78a020c45a.
  The staged archive contains the exact 57 header blobs and license from that
  commit, with sorted file paths and normalized file mode and timestamps.
  SHA-256 `21b07737afe5ed2befe25eb6d3bafabef57f30e165ea9491f04a266a6605e138`.
- FFmpeg nv-codec-headers 12.1.14.0:
  https://codeload.github.com/FFmpeg/nv-codec-headers/tar.gz/refs/tags/n12.1.14.0
  SHA-256 `2fefaa227d2a3b4170797796425a59d1dd2ed5fd231db9b4244468ba327acd0b`.

FFmpeg is configured with GPL, nonfree and version3 components disabled and
uses LGPL 2.1 or later. Intel oneVPL is MIT licensed. The patch
`onevpl-mingw.patch` limits the dispatcher's Microsoft compiler version check
to MSVC. Its equivalent is used by BtbN's public FFmpeg build recipe.
The LGPL `ffmpeg-7.1-mf-h264-low-delay.patch` maps the existing FFmpeg
`-flags +low_delay` option to the Media Foundation H.264 software encoder's
low-latency property before setting the output type. The hardware encoders
retain their existing options.
[Microsoft's codec property reference](https://learn.microsoft.com/en-us/windows/win32/medfound/codecapi-avlowlatencymode).

## Rebuild

Use an Ubuntu 24.04 environment with these unmodified distribution tools:

```sh
sudo apt-get update
sudo apt-get install --no-install-recommends \
  gcc-mingw-w64-x86-64-posix g++-mingw-w64-x86-64-posix \
  mingw-w64-tools nasm cmake ninja-build pkg-config curl xz-utils patch
bash packaging/ffmpeg/build.sh
```

The script verifies the pinned archives and FFmpeg patch, applies both
patches, builds the static oneVPL dispatcher and includes the AMF and NVIDIA
headers. FFmpeg uses BGRA rawvideo through a pipe and NV12 conversion to
produce H.264 Annex B. Encoders are Intel QSV with a D3D11 child device, AMD
AMF, NVIDIA NVENC, and Windows Media Foundation. The host preserves the
Media Foundation encoder's native access unit delimiters. The H.264
metadata bitstream filter is available in the build. The binary
must import only Windows system DLLs, with no additional FFmpeg, oneVPL,
MinGW or libgcc DLL. At runtime vendor encoders use the user's graphics
drivers. The NVIDIA headers require driver 531.61 or newer on Windows.

The output is `dist/ffmpeg-lgpl71/` containing `bin/ffmpeg.exe`, complete
source archives, this exact recipe/patch, notices, build logs/configuration,
compiler package versions, DLL-import evidence and SHA-256 manifest.

Linux build checks establish which wrappers and filters were compiled. Verify the
native Windows binary with real BGRA pipe input and H.264 output for each
supported encoder. Media Foundation software availability depends on the
Windows media components. A physical GPU test is required for each vendor
before claiming that vendor's hardware path has passed.

Official references:

- https://ffmpeg.org/legal.html
- https://github.com/intel/libvpl/tree/5f6bd8a1e753c8f63a3fd8b36894d6968b808a6d
- https://github.com/BtbN/FFmpeg-Builds/blob/master/scripts.d/50-onevpl.sh
