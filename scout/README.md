<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/76ad9fff-559b-4f9b-9a43-2b13e3635e9b

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create a `.env` file in the root directory and add the following keys:
   - `GEMINI_API_KEY`: Your Google Gemini API key
   - `PINECONE_KEY`: Your Pinecone API key
   - `PINECONE_INDEX`: Your Pinecone index name (defaults to `plex-index` if not set)
3. Run the app:
   `npm run dev`
