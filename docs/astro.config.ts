import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
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
          items: [{ label: "The repository", link: "/building/repository/" }],
        },
        { label: "Decisions", link: "/decisions/" },
      ],
    }),
  ],
});
