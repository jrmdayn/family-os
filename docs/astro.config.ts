import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  // The prod stage of alchemy.run.ts serves the docs here.
  site: "https://family-os-docs.jrmdayn.workers.dev",
  integrations: [
    starlight({
      title: "Family OS",
      description: "How Family OS is built: a household admin app you talk to through an LLM.",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/jrmdayn/family-os" }],
      editLink: {
        baseUrl: "https://github.com/jrmdayn/family-os/edit/main/docs/",
      },
      sidebar: [
        { label: "Overview", link: "/" },
        { label: "Roadmap", link: "/roadmap/" },
        {
          label: "How it's built",
          items: [
            { label: "The repository", link: "/building/repository/" },
            { label: "The babysitting model", link: "/building/babysitting-model/" },
            { label: "Local development", link: "/building/local-development/" },
            { label: "Deploying", link: "/building/deploying/" },
            { label: "Deploy credentials", link: "/building/deploy-credentials/" },
          ],
        },
        { label: "Decisions", link: "/decisions/" },
      ],
    }),
  ],
});
