export default {
  name: 'featuredTool',
  title: 'Featured Tool',
  type: 'document',
  fields: [
    {name: 'title', type: 'string', validation: (r) => r.required()},
    {
      name: 'titleFontSize',
      title: 'Title Font Size',
      type: 'string',
      options: {
        list: [
          {title: 'Small', value: 'text-lg'},
          {title: 'Medium', value: 'text-xl'},
          {title: 'Large', value: 'text-2xl'},
          {title: 'Extra Large', value: 'text-3xl'},
          {title: 'Huge', value: 'text-4xl'},
          {title: 'Massive', value: 'text-5xl'},
          {title: 'Giant', value: 'text-6xl'},
          {title: 'Enormous', value: 'text-7xl'},
        ],
      },
      initialValue: 'text-2xl',
      description: 'Controls the size of the main title text',
    },
    {name: 'subtitle1', title: 'Subtitle 1', type: 'string'},
    {name: 'subtitle2', title: 'Subtitle 2', type: 'string'},
    {name: 'description', type: 'string', validation: (r) => r.required()},
    {name: 'boldText', title: 'Bold Text', type: 'string', validation: (r) => r.required()},
    {name: 'linkHref', title: 'Link URL', type: 'string', validation: (r) => r.required()},
    {
      name: 'mediaType',
      title: 'Background Media Type',
      type: 'string',
      options: {
        list: [
          {title: 'Image', value: 'image'},
          {title: 'Video', value: 'video'},
          {title: 'Gradient Only', value: 'gradient'},
        ],
      },
      initialValue: 'gradient',
    },
    {name: 'backgroundImage', title: 'Background Image', type: 'image', options: {hotspot: true}},
    {name: 'backgroundVideo', title: 'Background Video', type: 'file'},
    {name: 'backgroundVideoUrl', title: 'Background Video URL', type: 'url'},
    {
      name: 'overlayOpacity',
      title: 'Overlay Opacity',
      type: 'string',
      options: {
        list: [
          {title: 'None (0%)', value: '0'},
          {title: 'Light (20%)', value: '20'},
          {title: 'Medium (40%)', value: '40'},
          {title: 'Dark (60%)', value: '60'},
          {title: 'Very Dark (80%)', value: '80'},
        ],
      },
      initialValue: '40',
      description: 'Controls how dark the overlay is over background images/videos',
    },
    {
      name: 'gradientColor',
      title: 'Gradient Color (fallback)',
      type: 'string',
      options: {
        list: [
          {title: 'Purple/Blue', value: 'purple'},
          {title: 'Green/Teal', value: 'green'},
          {title: 'Orange/Red', value: 'orange'},
        ],
      },
      validation: (r) => r.required(),
    },
    {name: 'order', type: 'number', validation: (r) => r.required()},
    {name: 'public', type: 'boolean', initialValue: true},
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'boldText',
      media: 'backgroundImage',
    },
  },
}
