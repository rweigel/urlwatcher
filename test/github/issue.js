import { Octokit } from "@octokit/rest";

async function createIssue() {
  const octokit = new Octokit({
    auth: "GITHUB_PAT"
  });

  const owner = "rweigel";
  const repo = "viviz";

  const issueData = {
    title: "Issue Title",
    body: "Issue description",
    assignees: ["octocat"],
    labels: ["bug"]
  };

  try {
    const response = await octokit.rest.issues.create({
      owner,
      repo,
      ...issueData
    });

    console.log("Issue created:", response.data.html_url);
  } catch (error) {
    console.error("Error creating issue:", error);
  }
}

// Run the function if the script is executed directly
if (require.main === module) {
  createIssue();
}
