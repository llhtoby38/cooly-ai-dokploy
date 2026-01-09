import {defineConfig} from 'sanity'
import {deskTool} from 'sanity/desk'
import {visionTool} from '@sanity/vision'
import schemas from './sanity/schemas'

export default defineConfig({
  name: 'cooly',
  title: 'Cooly CMS',
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 'zlcfuo6a',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  basePath: '/studio',
  plugins: [deskTool(), visionTool()],
  schema: {types: schemas},
  api: {
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 'zlcfuo6a',
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  },
  server: {
    port: 3333,
  },
})


