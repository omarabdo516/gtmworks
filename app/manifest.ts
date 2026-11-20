import type { MetadataRoute } from 'next';

// #453: a browser tab and an installed app show the gtmworks mark. The manifest names the app, its colour and the
// icons drawn from brand/mark.svg, so an install from Brave, Chrome or a phone stands as gtmworks.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'gtmworks',
    short_name: 'gtmworks',
    start_url: '/',
    display: 'standalone',
    theme_color: '#1C1C1C',
    background_color: '#FCFCFC',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
