from github import Github

# Replace with your actual details
token = "GITHUB_PAT"
repo_name = "rweigel/viviz"
issue_number = 10  # Replace with the issue number

# Authenticate
g = Github(token)
repo = g.get_repo(repo_name)
issue = repo.get_issue(issue_number)

# Post a comment
issue.create_comment("This is a comment from Python!")
