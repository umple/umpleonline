import { describe, expect, it } from 'vitest'
import { findDiagramRange } from './diagramSelection'

describe('findDiagramRange', () => {
  it('matches the correct repeated state name inside its owning state machine', () => {
    const code = `class Phone {
  ringerSound {
    Off{
      callReceived [!permanentMute] -> On ;
    }

    On{
      silentButton -> Off ;
    }
  }

  screenLight {
    Off{
      callReceived -> On ;
      pickUp -> On;
      dial -> On;
    }

    On{
      after(30000) -> Dimmed;
      hangUp -> Off;
    }
  }

  vibration {
    Off {
      callReceived -> On ;
     }
  }
}
`

    const range = findDiagramRange(code, { name: 'Phone_screenLight_Off', kind: 'node' })
    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe(`    Off{
      callReceived -> On ;
      pickUp -> On;
      dial -> On;
    }`)
  })

  it('keeps numeric suffixes that are part of numbered state names', () => {
    const code = `class Oven1 {
  cook { OFF{} ON{} }
  Integer leftTime = 0;
  ovenstate {
    s1_1 {
      enterTime(Integer t) [t > 0] / {leftTime = t;} -> s1_2;
    }
    s1_2 {
      enterTime(Integer t) [t > 0] / {leftTime = t;} -> s1_2;
      start / {cook = Cook.ON;} -> s1_3;
    }
    s1_3 {
    }
  }
}
`

    const range = findDiagramRange(code, { name: 'Oven1_ovenstate_s1_1', kind: 'node' })
    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe(`    s1_1 {
      enterTime(Integer t) [t > 0] / {leftTime = t;} -> s1_2;
    }`)
  })

  it('matches a multi-line state transition instead of falling back to the source state', () => {
    const code = `class ItemAtAuction {
  status {
    created {

      listitem(double reserve) / {
        reservePrice = reserve;
        active = true;
      }
      -> listed;
    }

    listed {
    }
  }
}
`

    const range = findDiagramRange(code, {
      name: 'ItemAtAuction_status_created->ItemAtAuction_status_listed',
      kind: 'edge',
      anchorTitle: `From created to listed on listitem(double reserve)
Transition Action:
    reservePrice = reserve;
    active = true;`,
    })

    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe(`      listitem(double reserve) / {
        reservePrice = reserve;
        active = true;
      }
      -> listed;`)
  })

  it('matches an automatic transition without falling back to the source state', () => {
    const code = `class X {
  sm {
    s1 {
      -> s2;
    }

    s2 {
    }
  }
}
`

    const range = findDiagramRange(code, {
      name: 'X_sm_s1->X_sm_s2',
      kind: 'edge',
      anchorTitle: 'From s1 to s2 automatically',
    })

    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe('      -> s2;')
  })

  it('matches a guarded automatic transition without falling back to the source state', () => {
    const code = `class X {
  sm {
    s1 {
      [guard] -> s2;
    }

    s2 {
    }
  }
}
`

    const range = findDiagramRange(code, {
      name: 'X_sm_s1->X_sm_s2',
      kind: 'edge',
      anchorTitle: `From s1 to s2 automatically
Guard: [guard]`,
    })

    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe('      [guard] -> s2;')
  })

  it('still resolves simple instance ids back to their class definitions', () => {
    const code = `class Segment {
  bend;
}

class Lock {
}
`

    const range = findDiagramRange(code, { name: 'Segment_12', kind: 'node' })
    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe(`class Segment {
  bend;
}`)
  })
})


describe('class diagram selection (issue #2257)', () => {
  function selected(code: string, name: string, kind: 'node' | 'edge') {
    const range = findDiagramRange(code, { name, kind })
    expect(range).not.toBeNull()
    return code.slice(range!.from, range!.to)
  }

  it.each(['1--*Y;', '1--* Y;', '1 -- * Y;', '1->*Y;', '* Y -- 1;'])(
    'selects only the association statement: %s', (association) => {
      const code = `class X {
  ${association}
  String following;
}
class Y {}`
      expect(selected(code, 'X->Y', 'edge')).toBe(`  ${association}`)
      expect(selected(code, 'Y->X', 'edge')).toBe(`  ${association}`)
    },
  )

  it.each(['', '\n', '\n\n'])('selects a class with trailing text %j', (suffix) => {
    const definition = 'class X {\n  String value;\n}'
    expect(selected(definition + suffix, 'X', 'node')).toBe(definition)
  })

  it('ignores declarations and unmatched braces inside comments and strings', () => {
    const definition = `class X {
  // }
  String value = "{";
  /* } */
}`
    const code = `// class X {}
${definition}
class Y {}`
    expect(selected(code, 'X', 'node')).toBe(definition)
  })

  it('scopes associations to their owner and skips comments and method bodies', () => {
    const code = `class Other { 1--*Y; }
class X {
  // 1--*Y;
  void method() { String fake = "1--*Y;"; }
  1--*Y;
}
class Y {}`
    expect(selected(code, 'X->Y', 'edge')).toBe('  1--*Y;')
  })

  it('selects an inline association without including adjacent declarations', () => {
    expect(selected('class X { 1--*Y; String next; } class Y {}', 'X->Y', 'edge')).toBe('1--*Y;')
  })

  it('selects an inheritance statement', () => {
    expect(selected('class X {\n  isA Y;\n}\nclass Y {}', 'X->Y', 'edge')).toBe('  isA Y;')
  })
})
