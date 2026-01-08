import { error } from '@sveltejs/kit'

import { subtitleList, type Subtitle } from '$lib/constants'

export function load ({ params }): Subtitle {
  const subtitle = subtitleList[params.subtitle]
  if (!subtitle) {
    return error(404, 'Subtitle not found')
  }
  return subtitle
}
