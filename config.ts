export default {
  /** The base URLs of the baseline and candidate versions to visually compare. */
  baseUrl: {
    baseline: 'https://starlight.astro.build',
    candidate: 'http://localhost:4321',
  },
  /** A list of all the routes to visually compare between the baseline and candidate versions. */
  paths: ['/', '/getting-started/'],
  /** The maximum number of mismatched pixels between the baseline and candidate page screenshots. */
  maxDiffPixels: 10,
}
