import { getUnitRegexp } from './pixel-unit-regexp'
import { createPropListMatcher } from './prop-list-matcher'
import type { OptionType, ParentExtendType, RuleType } from './types'
import { blacklistedSelector, createPxReplace, declarationExists, getUnit, getWidth, isExclude, validateParams } from './utils'

import type { AtRule, Declaration, Helpers, Root } from 'postcss'

const defaults: Required<Omit<OptionType, 'exclude' | 'include'>> = {
  unitToConvert: 'px',
  viewportWidth: 320,
  viewportHeight: 568, // not now used; TODO: need for different units and math for different properties
  unitPrecision: 5,
  viewportUnit: 'vw',
  fontViewportUnit: 'vw', // vmin is more suitable.
  selectorBlackList: [],
  propList: ['*'],
  minPixelValue: 1,
  mediaQuery: false,
  replace: true,
  landscape: false,
  landscapeUnit: 'vw',
  landscapeWidth: 568,
  mediaOptions: [],
}

const ignoreNextComment = 'px-to-viewport-ignore-next'
const ignorePrevComment = 'px-to-viewport-ignore'

const postcssPxToViewport = (options: OptionType) => {
  const opts = Object.assign({}, defaults, options)

  const pxRegex = getUnitRegexp(opts.unitToConvert)
  const satisfyPropList = createPropListMatcher(opts.propList)
  const landscapeRules: AtRule[] = []
  const mediaRules: Array<{
    mediaParam: string
    rules: AtRule[]
  }> = []
  return {
    postcssPlugin: 'postcss-px-to-viewport',
    Once(css: Root, { result }: Helpers) {
      // @ts-ignore 补充类型
      css.walkRules((rule: RuleType) => {
        // Add exclude option to ignore some files like 'node_modules'
        const file = rule.source?.input.file || ''
        if (opts.exclude && file) {
          if (Object.prototype.toString.call(opts.exclude) === '[object RegExp]') {
            if (isExclude(opts.exclude as RegExp, file)) return
          } else if (
            // Object.prototype.toString.call(opts.exclude) === '[object Array]' &&
            opts.exclude instanceof Array
          ) {
            for (let i = 0; i < opts.exclude.length; i++) {
              if (isExclude(opts.exclude[i], file)) return
            }
          } else {
            throw new Error('options.exclude should be RegExp or Array.')
          }
        }

        if (blacklistedSelector(opts.selectorBlackList, rule.selector)) return

        if (opts.landscape && !rule.parent?.params) {
          const landscapeRule = rule.clone().removeAll()
          rule.walkDecls((decl: Declaration) => {
            if (decl.value.indexOf(opts.unitToConvert) === -1) return
            if (!satisfyPropList(decl.prop)) return
            const landscapeWidth = getWidth(opts.landscapeWidth, file)
            if (!landscapeWidth) return

            landscapeRule.append(
              decl.clone({
                value: decl.value.replace(pxRegex, createPxReplace(opts, opts.landscapeUnit, landscapeWidth)),
              })
            )
          })

          if (landscapeRule.nodes.length > 0) {
            landscapeRules.push(landscapeRule as unknown as AtRule)
          }
        }

        // 若配置了其他媒体查询设置， 且当前规则非媒体查询
        if (opts.mediaOptions?.length && !rule.parent?.params) {
          for (let i = 0; i < opts.mediaOptions.length; i++) {
            const { viewportWidth, viewportUnit = opts.viewportUnit, mediaParam } = opts.mediaOptions[i]
            const mediaRule = rule.clone().removeAll()
            rule.walkDecls((decl: Declaration) => {
              if (decl.value.indexOf(opts.unitToConvert) === -1) return
              if (!satisfyPropList(decl.prop)) return
              const width = getWidth(viewportWidth!, file)
              if (!width) return
              mediaRule.append(
                decl.clone({
                  value: decl.value.replace(pxRegex, createPxReplace(opts, viewportUnit, width)),
                })
              )
            })
            if (mediaRule.nodes.length > 0) {
              if (!mediaRules[i]) {
                mediaRules[i] = {
                  mediaParam,
                  rules: [],
                }
              }
              mediaRules[i].rules.push(mediaRule as unknown as AtRule)
            }
          }
        }

        // 若当前css规则是media且未开启媒体查询单位转换配置则跳过执行后续步骤
        if (!validateParams(rule.parent?.params, opts.mediaQuery)) return

        rule.walkDecls((decl, i) => {
          if (decl.value.indexOf(opts.unitToConvert) === -1) return
          if (!satisfyPropList(decl.prop)) return

          const prev = decl.prev()
          // prev declaration is ignore conversion comment at same line
          if (prev && prev.type === 'comment' && prev.text === ignoreNextComment) {
            // remove comment
            prev.remove()
            return
          }
          const next = decl.next()
          // next declaration is ignore conversion comment at same line
          if (next && next.type === 'comment' && next.text === ignorePrevComment) {
            if (/\n/.test(next.raws.before!)) {
              result.warn(`Unexpected comment /* ${ignorePrevComment} */ must be after declaration at same line.`, { node: next })
            } else {
              // remove comment
              next.remove()
              return
            }
          }

          let unit
          let size
          const { params } = rule.parent

          if (opts.landscape && params && params.indexOf('landscape') !== -1) {
            unit = opts.landscapeUnit
            const num = getWidth(opts.landscapeWidth, file)
            if (!num) return
            size = num
          } else {
            unit = getUnit(decl.prop, opts)
            const num = getWidth(opts.viewportWidth, file)
            if (!num) return
            size = num
          }

          const value = decl.value.replace(pxRegex, createPxReplace(opts, unit!, size))

          if (declarationExists(decl.parent as unknown as ParentExtendType[], decl.prop, value)) return

          if (opts.replace) {
            decl.value = value
          } else {
            decl.parent?.insertAfter(i, decl.clone({ value }))
          }
        })
      })
    },
    // https://www.postcss.com.cn/docs/writing-a-postcss-plugin
    // Declaration Rule RuleExit OnceExit
    // There two types or listeners: enter and exit.
    // Once, Root, AtRule, and Rule will be called before processing children.
    // OnceExit, RootExit, AtRuleExit, and RuleExit after processing all children inside node.
    OnceExit(css: Root, { AtRule }: Helpers) {
      // 在 Once里跑这段逻辑，设置横屏时，打包后到生产环境竖屏样式会覆盖横屏样式，所以 OnceExit再执行。
      if (landscapeRules.length > 0) {
        const landscapeRoot = new AtRule({
          params: '(orientation: landscape)',
          name: 'media',
        })
        appendRule(landscapeRoot, landscapeRules)
        css.append(landscapeRoot)
      }
      if (mediaRules.length > 0) {
        for (let i = 0; i < mediaRules.length; i++) {
          let item = mediaRules[i]
          let { mediaParam, rules } = item
          const mediaRoot = new AtRule({
            params: mediaParam,
            name: 'media',
          })
          appendRule(mediaRoot, rules)
          css.append(mediaRoot)
        }
      }
    },
  }
}

function appendRule(rule: AtRule, data: AtRule[]) {
  data.forEach((item) => {
    rule.append(item)
  })
}

postcssPxToViewport.postcss = true
export default postcssPxToViewport
