{ pkgs }: {
  deps = [
    pkgs.pkg-config
    pkgs.replitPackages.prybar-python310
    pkgs.replitPackages.stderred
  ];
}