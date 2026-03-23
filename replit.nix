{ pkgs }: {
  deps = [
    pkgs.nodejs-20_x
    pkgs.ffmpeg-headless
    pkgs.yt-dlp
    pkgs.libuuid
  ];
}
