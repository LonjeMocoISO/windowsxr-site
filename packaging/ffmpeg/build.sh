#!/usr/bin/env bash
# Windows XR's separately-executed FFmpeg command-line encoder.
# This recipe does not modify the Windows Host or the Quest APK.
set -euo pipefail
export LC_ALL=C

RECIPE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${FFMPEG_WORK_DIR:-$PWD/ffmpeg-build-work}"
DIST_DIR="${FFMPEG_DIST_DIR:-$PWD/dist/ffmpeg-lgpl71}"
PREFIX="$WORK_DIR/prefix"
mkdir -p "$WORK_DIR/downloads" "$WORK_DIR/src" "$PREFIX" "$DIST_DIR/bin" "$DIST_DIR/source" "$DIST_DIR/licenses" "$DIST_DIR/build-info"
exec > >(tee "$DIST_DIR/build-info/build.log") 2>&1

FFMPEG_URL='https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz'
FFMPEG_SHA256='40973d44970dbc83ef302b0609f2e74982be2d85916dd2ee7472d30678a7abe6'
VPL_URL='https://codeload.github.com/intel/libvpl/tar.gz/5f6bd8a1e753c8f63a3fd8b36894d6968b808a6d'
VPL_SHA256='ad4c5b0e46035568fa43371e99a6267cd00b1e8c58c78d606b9687930f7ca4b9'
AMF_SHA256='21b07737afe5ed2befe25eb6d3bafabef57f30e165ea9491f04a266a6605e138'
NV_HEADERS_URL='https://codeload.github.com/FFmpeg/nv-codec-headers/tar.gz/refs/tags/n12.1.14.0'
NV_HEADERS_SHA256='2fefaa227d2a3b4170797796425a59d1dd2ed5fd231db9b4244468ba327acd0b'

fetch_verified() {
    local url="$1" target="$2" expected="$3"
    curl --fail --location --retry 3 --connect-timeout 20 --max-time 180 "$url" --output "$target"
    printf '%s  %s\n' "$expected" "$target" | sha256sum --check --strict
}
fetch_verified "$FFMPEG_URL" "$WORK_DIR/downloads/ffmpeg-7.1.tar.xz" "$FFMPEG_SHA256"
fetch_verified "$VPL_URL" "$WORK_DIR/downloads/libvpl-2.13.0.tar.gz" "$VPL_SHA256"
fetch_verified "$NV_HEADERS_URL" "$WORK_DIR/downloads/nv-codec-headers-12.1.14.0.tar.gz" "$NV_HEADERS_SHA256"
AMF_HEADERS="$RECIPE_DIR/amf-1.4.35-headers.tar.gz"
MF_PATCH="$RECIPE_DIR/ffmpeg-7.1-mf-h264-low-delay.patch"
printf '%s  %s\n' "$AMF_SHA256" "$AMF_HEADERS" \
    'bbf94e7283bed73135c6ca3e85d6ae34aae4a07fe74702d85a81b79cfc967244' "$MF_PATCH" | sha256sum --check --strict
cp "$WORK_DIR/downloads/"{ffmpeg-7.1.tar.xz,libvpl-2.13.0.tar.gz,nv-codec-headers-12.1.14.0.tar.gz} \
    "$AMF_HEADERS" "$MF_PATCH" "$DIST_DIR/source/"
cp "$RECIPE_DIR/build.sh" "$RECIPE_DIR/README.md" "$RECIPE_DIR/onevpl-mingw.patch" "$DIST_DIR/source/"
ATTRIBUTION_DIR="$RECIPE_DIR"
if [[ ! -f "$ATTRIBUTION_DIR/BtbN-LICENSE.txt" ]]; then ATTRIBUTION_DIR="$RECIPE_DIR/../licenses"; fi
cp "$ATTRIBUTION_DIR/BtbN-LICENSE.txt" "$ATTRIBUTION_DIR/BtbN-ATTRIBUTION.txt" "$DIST_DIR/licenses/"
tar -xJf "$WORK_DIR/downloads/ffmpeg-7.1.tar.xz" -C "$WORK_DIR/src"
tar -xzf "$WORK_DIR/downloads/libvpl-2.13.0.tar.gz" -C "$WORK_DIR/src"
tar -xzf "$WORK_DIR/downloads/nv-codec-headers-12.1.14.0.tar.gz" -C "$WORK_DIR/src"
mkdir -p "$WORK_DIR/src/amf"
tar -xzf "$AMF_HEADERS" -C "$WORK_DIR/src/amf"
NV_HEADERS="$WORK_DIR/src/nv-codec-headers-n12.1.14.0"

VPL_SOURCE="$WORK_DIR/src/libvpl-5f6bd8a1e753c8f63a3fd8b36894d6968b808a6d"
patch --directory="$VPL_SOURCE" --strip=1 < "$RECIPE_DIR/onevpl-mingw.patch"
patch --directory="$WORK_DIR/src/ffmpeg-7.1" --strip=1 < "$MF_PATCH"

cat > "$WORK_DIR/mingw-toolchain.cmake" <<'TOOLCHAIN'
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER x86_64-w64-mingw32-gcc-posix)
set(CMAKE_CXX_COMPILER x86_64-w64-mingw32-g++-posix)
set(CMAKE_RC_COMPILER x86_64-w64-mingw32-windres)
set(CMAKE_FIND_ROOT_PATH /usr/x86_64-w64-mingw32)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
TOOLCHAIN
cp "$WORK_DIR/mingw-toolchain.cmake" "$DIST_DIR/source/"

cmake -S "$VPL_SOURCE" -B "$WORK_DIR/vpl-build" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="$WORK_DIR/mingw-toolchain.cmake" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_INSTALL_BINDIR=bin \
    -DCMAKE_C_FLAGS_RELEASE='-O2 -DNDEBUG' \
    -DCMAKE_CXX_FLAGS_RELEASE='-O2 -DNDEBUG -static-libgcc -static-libstdc++' \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTS=OFF -DBUILD_EXAMPLES=OFF \
    -DINSTALL_DEV=ON -DINSTALL_LIB=ON -DBUILD_EXPERIMENTAL=ON
cmake --build "$WORK_DIR/vpl-build" --parallel "$(nproc)"
cmake --install "$WORK_DIR/vpl-build"

mkdir -p "$PREFIX/include/AMF"
cp -R "$WORK_DIR/src/amf/amf/public/include/." "$PREFIX/include/AMF/"
make -C "$NV_HEADERS" PREFIX="$PREFIX" LIBDIR=lib install
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
pkg-config --modversion vpl ffnvcodec
pkg-config --static --cflags --libs vpl

cd "$WORK_DIR/src/ffmpeg-7.1"
CONFIGURE=(
    --target-os=mingw32 --arch=x86_64 --enable-cross-compile
    --cc=x86_64-w64-mingw32-gcc-posix --cxx=x86_64-w64-mingw32-g++-posix
    --cross-prefix=x86_64-w64-mingw32- --pkg-config=pkg-config --pkg-config-flags=--static
    --prefix="$PREFIX" --extra-cflags="-I$PREFIX/include"
    --extra-ldflags="-L$PREFIX/lib -static -static-libgcc -static-libstdc++"
    --disable-autodetect --disable-gpl --disable-nonfree --disable-version3
    --disable-everything --disable-doc --disable-debug
    --disable-programs --enable-ffmpeg --disable-ffplay --disable-ffprobe
    --disable-network --disable-avdevice --disable-postproc --disable-swresample
    --enable-static --disable-shared --disable-pthreads --enable-w32threads
    --enable-libvpl --enable-d3d11va --enable-dxva2
    --enable-amf --enable-ffnvcodec --enable-nvenc --enable-mediafoundation
    --enable-avcodec --enable-avformat --enable-avfilter --enable-swscale
    --enable-demuxer=rawvideo --enable-decoder=rawvideo
    --enable-encoder=h264_qsv,h264_amf,h264_nvenc,h264_mf
    --enable-muxer=h264 --enable-protocol=pipe --enable-parser=h264
    --enable-bsf=h264_metadata,h264_mp4toannexb
    --enable-filter=buffer,buffersink,format,scale,null
)
printf '%q ' ./configure "${CONFIGURE[@]}" > "$DIST_DIR/build-info/configure-command.txt"
printf '\n' >> "$DIST_DIR/build-info/configure-command.txt"
./configure "${CONFIGURE[@]}"
make -j"$(nproc)" ffmpeg.exe
cp ffmpeg.exe "$DIST_DIR/bin/ffmpeg.exe"
cp ffbuild/config.log config.h config_components.h "$DIST_DIR/build-info/"
cp COPYING.LGPLv2.1 "$DIST_DIR/licenses/FFmpeg-LGPL-2.1.txt"
cp LICENSE.md "$DIST_DIR/licenses/FFmpeg-LICENSE.md"
cp "$VPL_SOURCE/LICENSE" "$DIST_DIR/licenses/oneVPL-MIT.txt"
cp "$VPL_SOURCE/third-party-programs.txt" "$DIST_DIR/licenses/oneVPL-third-party-programs.txt"
cp "$WORK_DIR/src/amf/LICENSE.txt" "$DIST_DIR/licenses/AMD-AMF-MIT.txt"
{
    for header in "$NV_HEADERS/include/ffnvcodec/"*.h; do
        printf '\n%s\n' "$(basename "$header")"
        awk '{print} /\*\// {exit}' "$header"
    done
} > "$DIST_DIR/licenses/NVIDIA-codec-headers-MIT.txt"
cp "$NV_HEADERS/README" "$DIST_DIR/licenses/NVIDIA-codec-headers-README.txt"

# Runtime exception/permissive notices for the unmodified MinGW/GCC toolchain.
for notice in /usr/share/doc/gcc-mingw-w64-base/copyright /usr/share/doc/mingw-w64-common/copyright /usr/share/doc/libgcc-*-dev/copyright; do
    if [[ -f "$notice" ]]; then
        package="$(basename "$(dirname "$notice")")"
        cp "$notice" "$DIST_DIR/licenses/toolchain-$package.txt"
    fi
done
dpkg-query -W gcc-mingw-w64-x86-64-posix g++-mingw-w64-x86-64-posix mingw-w64-common nasm cmake ninja-build pkg-config > "$DIST_DIR/build-info/toolchain-versions.txt"
x86_64-w64-mingw32-objdump -p "$DIST_DIR/bin/ffmpeg.exe" > "$DIST_DIR/build-info/pe-imports.txt"
awk '/DLL Name:/{print $3}' "$DIST_DIR/build-info/pe-imports.txt" | tee "$DIST_DIR/build-info/dll-imports.txt"
if grep -Eiq 'libgcc|libstdc\+\+|libwinpthread|libvpl|avcodec|avformat|avutil|avfilter|swscale' "$DIST_DIR/build-info/dll-imports.txt"; then
    echo 'ERROR: unexpected external compiler/FFmpeg/dispatcher DLL dependency.' >&2
    exit 1
fi
grep -q '^#define CONFIG_GPL 0$' config.h
grep -q '^#define CONFIG_NONFREE 0$' config.h
grep -q '^#define CONFIG_VERSION3 0$' config.h
for component in H264_QSV_ENCODER H264_AMF_ENCODER H264_NVENC_ENCODER H264_MF_ENCODER H264_METADATA_BSF; do
    grep -q "^#define CONFIG_${component} 1$" config_components.h
done
grep -q '^#define CONFIG_D3D11VA 1$' config.h
grep -q '^#define CONFIG_LIBVPL 1$' config.h

cat > "$DIST_DIR/NOTICE.txt" <<'NOTICE'
Windows XR FFmpeg command-line encoder

FFmpeg 7.1, Copyright (c) 2000-2024 the FFmpeg developers.
Built with GPL, version3 and nonfree components disabled. FFmpeg is licensed
under GNU LGPL version 2.1 or later. See licenses/FFmpeg-LGPL-2.1.txt.

Intel oneVPL dispatcher 2.13.0, Copyright (c) Intel Corporation, MIT license.
See licenses/oneVPL-MIT.txt and oneVPL-third-party-programs.txt.
AMD AMF SDK 1.4.35 headers and FFmpeg nv-codec-headers 12.1.14.0 are MIT
licensed. See the respective upstream notices under licenses/. Their
graphics runtimes are supplied by the installed drivers. Windows supplies
the Media Foundation software encoder.

This executable is a separate program called by Windows XR through standard
input/output. Complete FFmpeg and oneVPL sources, the upstream header
archives, the build recipe and both source patches are in source/. The FFmpeg
patch maps its existing low-delay flag to the Windows H.264 software encoder.
Build configuration and runtime DLL imports are in build-info/.
You may replace this separately-executed ffmpeg.exe with a compatible build.
No warranty is provided for these third-party components.
NOTICE

cd "$DIST_DIR"
find bin source licenses build-info -type f ! -name build.log -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS.txt
sha256sum NOTICE.txt >> SHA256SUMS.txt
echo 'Windows XR FFmpeg build complete.'
