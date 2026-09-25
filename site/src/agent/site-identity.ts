/** Canonical structured identity published on every cueloop.dev HTML page. */
export const cueloopIdentityGraph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://www.cueloop.dev/#software",
      name: "cueloop",
      description: "A terminal-first review surface for coding agents.",
      url: "https://www.cueloop.dev/",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Linux, Windows",
      codeRepository: "https://github.com/mmurakaru/cueloop",
      downloadUrl: "https://www.npmjs.com/package/cueloop",
      softwareHelp: "https://www.cueloop.dev/docs/",
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      author: { "@id": "https://www.cueloop.dev/#project" },
    },
    {
      "@type": "Organization",
      "@id": "https://www.cueloop.dev/#project",
      name: "cueloop",
      url: "https://www.cueloop.dev/",
      email: "hello@cueloop.dev",
      sameAs: ["https://github.com/mmurakaru/cueloop"],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "support",
        email: "hello@cueloop.dev",
        url: "https://www.cueloop.dev/contact/",
      },
    },
  ],
} as const;
