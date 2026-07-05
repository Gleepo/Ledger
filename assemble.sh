#!/bin/sh
# Assemble lagoon-ledger.html from the three source files.
# Run core tests first; refuse to assemble on red.
set -e
node core.test.js > /dev/null
{
  sed -n '1,/^<style>$/p' template-head.html 2>/dev/null || cat << 'HEAD'
<!DOCTYPE html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0E3B43">
<title>Lagoon Ledger</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='46' fill='%230E3B43'/%3E%3Cpath d='M18 58 Q34 48 50 58 T82 58' stroke='%232F9E96' stroke-width='7' fill='none' stroke-linecap='round'/%3E%3Cpath d='M24 72 Q37 64 50 72 T76 72' stroke='%23E9E2D0' stroke-width='5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E">
<style>
HEAD
  cat style.css
  printf '</style>\n</head>\n<body>\n<div id="app"></div>\n<noscript><p style="padding:2rem;font-family:sans-serif">Lagoon Ledger needs JavaScript.</p></noscript>\n<script>\n'
  cat core.js
  printf '</script>\n<script>\n'
  cat app.js
  printf '</script>\n</body>\n</html>\n'
} > lagoon-ledger.html
echo "assembled: lagoon-ledger.html ($(wc -c < lagoon-ledger.html) bytes)"
