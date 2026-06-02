# Parla

A voice-first English learning app that lets you practice natural conversation with an AI tutor anytime, anywhere.

## What is Parla?

Parla works like a phone call with your English tutor. Choose your tutor, pick a personality, set your English level and start talking. Your tutor corrects your mistakes naturally without breaking the flow of conversation.

## Tutors

- **Grace Fullspeak** — warm and friendly colleague
- **Ben Dover** — casual debate partner

## Personalities

- **Mate** — talkative friend who asks questions and shares stories
- **Teacher** — strict and precise, corrects every mistake
- **Debate Partner** — always takes the opposite view, challenges your arguments
- **Guided** — for complete beginners, speaks Polish and English, guides you through answers
- **Custom** — describe your own tutor for the session

## How to use

1. Open the app and choose your tutor
2. Pick a personality and English level
3. Tap Start Session and wait for your tutor to speak
4. Talk naturally — say **EOT** when you finish your turn
5. Tap End Session when done
6. Optionally save the session transcript as PDF

## Setup

Parla requires two API keys — enter them once in the Settings screen inside the app:

- **Anthropic API key** — get it at [console.anthropic.com](https://console.anthropic.com)
- **OpenAI API key** — get it at [platform.openai.com](https://platform.openai.com)

Keys are stored locally in your browser and never sent anywhere except the respective APIs.

## Tech stack

- Vanilla HTML, CSS, JavaScript — single page app
- [Claude API](https://anthropic.com) — conversation intelligence and corrections
- [OpenAI TTS](https://platform.openai.com/docs/guides/text-to-speech) — tutor voices
- Web Speech API — microphone input
- Hosted on GitHub Pages

## Cost

Parla uses pay-per-use APIs. Typical personal usage costs roughly $2-5/month. The app tracks your spending in real time and shows costs in both USD and PLN.

## Version

Current version: see app header.

## Author

Built by Damian Gwóźdź with a lot of help from Claude (Anthropic).
