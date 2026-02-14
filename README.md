This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

🛠 Prerequisites & Initial Setup
Add this section to your README.md to establish the "Golden Path" for new users.

Setup & Authorization
Before starting the Gemini Local server, you must ensure your environment is authenticated and the project directory is trusted by the Gemini CLI.

1. Install the Gemini CLI
If you haven't already, install the core CLI globally:
https://geminicli.com/docs/get-started/installation/

2. Authenticate with Google
Run the login command to perform the OAuth handshake:
https://geminicli.com/docs/get-started/authentication/

3. Authorize the Project Directory
The Gemini CLI uses a security model that requires explicit trust for every folder it interacts with. To authorize this project root:

Open your terminal in the gemini-local root directory.

Run a simple test command:
gemini "hello"

When prompted: "Do you trust this folder and allow Gemini to read its contents?", select Yes.

Note: This adds the project path to your global trusted folders list at ~/.gemini/trustedFolders.json.

4. Configure Local Memory
Ensure there is a GEMINI.md file in your project root. This file acts as the persistent "System Instruction" for the model when running in this specific directory.

5. Launch the Dashboard
Once the folder is trusted, you can start the development server:
npm run dev


Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
