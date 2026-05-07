<div align="center">
  <h1>starlight-visual-diff 🖼️</h1>
  <p>Compare Starlight documentation pages for visual differences.</p>
</div>

## Getting Started

1. Clone the repository
1. Install dependencies:
   ```bash
   pnpm install
   ```
1. Configure the tool in the `config.ts` file.
   - `baseUrl` defines the base URLs of the baseline and candidate versions to visually compare. These URLs can be local development servers or deployed environments.
   - `paths` defines the list of routes to visually compare between the baseline and candidate versions.
1. Run the visual diff:
   ```bash
   pnpm start
   ```

After running the tool, the terminal output will list all routes with visual differences between the baseline and candidate versions. For each route with visual differences, the terminal output includes the path to a diff image.

The following diff image shows visual differences caused by a small heading `line-height` change. Because the text takes up more vertical space, the layout shifts progressively further down the page.

![Visual diff screenshot highlighting layout shifts in a Starlight documentation page](./visual-diff.png)

## License

Licensed under the MIT License, Copyright © HiDeoo.

See [LICENSE](https://github.com/HiDeoo/starlight-visual-diff/blob/main/LICENSE) for more information.
