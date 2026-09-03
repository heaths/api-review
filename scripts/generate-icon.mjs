import sharp from 'sharp';

await sharp('assets/icon.svg')
  .resize(256, 256)
  .png()
  .toFile('assets/icon.png');
