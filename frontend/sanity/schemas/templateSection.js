import OrderRefsAutoInput from './components/OrderRefsAutoInput.jsx'
export default {
  name: 'templateSection',
  title: 'Template Section',
  type: 'document',
  fields: [
    { name: 'title', title: 'Title', type: 'string', validation: r => r.required() },
    { name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title', maxLength: 64 }, validation: r => r.required() },
    { name: 'order', title: 'Order', type: 'number', initialValue: 100 },
    { name: 'isVisible', title: 'Visible', type: 'boolean', initialValue: true },
    { name: 'limitPerRow', title: 'Max Items Per Row', type: 'number', initialValue: 24 },
    { name: 'autoScrollSpeed', title: 'Auto Scroll Speed', type: 'number', description: 'Pixels per frame (approx). 0 to disable for this row.' },
    {
      name: 'orderRefs',
      title: 'Ordering (optional)',
      type: 'array', // custom input auto-populates from tagged items
      components: { input: OrderRefsAutoInput },
      of: [{ 
        type: 'reference', 
        to: [{ type: 'showcaseItem' }],
        options: {
          // Only allow picking items that already reference this section
          filter: ({document}) => ({
            filter: 'defined(sections) && $secId in sections[]._ref',
            params: { secId: document?._id }
          })
        }
      }],
      description: 'Drag to set priority order. Only items already tagged with this section are selectable here. Membership is set on each Showcase Item (Sections field); this list only controls order.',
    },
  ]
}


