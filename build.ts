await Bun.build({
  entrypoints: ["./src/htmlFileAgent.js"],
  compile: {
    outfile: "./dist/htmlFileAgent.exe",
    windows: {
      title: "htmlFileAgent",
      publisher: "https://github.com/FatFatYoung",
      version: "1.4.1.0",
      copyright: "© 2026 FatFatYoung. All rights reserved.",
    },
  },
});

console.log("✓ htmlFileAgent.exe built → dist/");
