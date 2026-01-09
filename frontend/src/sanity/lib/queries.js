export const SHOWCASE_QUERY = `
*[_type == "showcaseItem" && public == true] | order(publishedAt desc) {
  _id, 
  title, 
  titleFontFamily,
  tool,
  templateSlug,
  caption, 
  captionFontSize,
  mediaType, 
  image, 
  "videoUrl": coalesce(videoUrl, video.asset->url),
  linkHref, 
  tags, 
  sections[]->,
  variant, 
  captionPlacement, 
  spanCols, 
  spanRows, 
  ratio, 
  publishedAt
}
`

export const FEATURED_TOOLS_QUERY = `
*[_type == "featuredTool" && public == true] | order(order asc) {
  _id,
  title,
  titleFontSize,
  subtitle1,
  subtitle2,
  description,
  boldText,
  linkHref,
  mediaType,
  backgroundImage,
  "backgroundVideoUrl": coalesce(backgroundVideoUrl, backgroundVideo.asset->url),
  overlayOpacity,
  gradientColor,
  order
}
`

export const TEMPLATE_SECTIONS_WITH_ITEMS_QUERY = `
*[_type == "templateSection" && isVisible == true] | order(order asc) {
  _id,
  title,
  "slug": slug.current,
  order,
  limitPerRow,
  autoScrollSpeed,
  // Fetch referenced items; ordering handled at runtime using orderRefs
  "items": *[_type == "showcaseItem" && public == true && references(^._id)] | order(publishedAt desc){
    _id, title, titleFontFamily, tool, templateSlug, caption, captionFontSize, mediaType, image,
    "videoUrl": coalesce(videoUrl, video.asset->url), linkHref, tags, sections[]->, variant, captionPlacement, spanCols, spanRows, ratio, publishedAt
  },
  // Ordered reference list used to prioritize items in UI
  "orderRefs": array::compact(orderRefs[]->_id)
}
`


