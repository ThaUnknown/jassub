import { error } from '@sveltejs/kit'

import { subtitleList, type Subtitle } from '$lib/constants'

export function load ({ params }): Subtitle {
  if (params.subtitle === 'manual') {
    return {
      delay: 0,
      // @ts-expect-error yes
      fonts: null,
      subUrl: '',
      videoUrl: ''
    }
  }
  const subtitle = subtitleList[params.subtitle]
  if (!subtitle) {
    return error(404, 'Subtitle not found')
  }
  return subtitle
}
