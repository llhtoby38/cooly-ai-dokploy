import {defineConfig} from 'sanity'
import {deskTool} from 'sanity/desk'
import {visionTool} from '@sanity/vision'
// Reuse the schemas from the frontend codebase
// Path relative to studio folder
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import schemas from '../frontend/sanity/schemas'

export default defineConfig({
  name: 'cooly-studio',
  title: 'Cooly CMS',
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || process.env.SANITY_PROJECT_ID || 'zlcfuo6a',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || process.env.SANITY_DATASET || 'production',
  plugins: [deskTool(), visionTool()],
  schema: {types: schemas},
})


