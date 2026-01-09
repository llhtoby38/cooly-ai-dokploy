import imageUrlBuilder from '@sanity/image-url'
import {sanityClient} from './client'

const builder = imageUrlBuilder(sanityClient)
export const urlFor = (src) => (src ? builder.image(src) : null)


