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

// Phase 2 regressions for the three transition-matching gaps. Every anchorTitle below
// is the Graphviz tooltip form of a `data-transition` payload captured from
// `java -jar jars/umplesync.jar -generate EventSequence`; the payload is quoted above
// each group it came from.

describe('findDiagramRange — nested transition destinations (G1)', () => {
  // Garage*^*sm*^*ev2*^*ss1.s1*^*ss1.s2*^*
  const nested = `class Garage {
  sm {
    ss1 {
      s1 {
        ev2 -> s2;
      }
      s2 {
        ev3 -> ss2.s3;
      }
      ev4 -> ss2;
    }
    ss2 {
      s3 {
      }
    }
  }
}
`

  it('selects the transition when the source abbreviates a nested destination', () => {
    const range = findDiagramRange(nested, {
      name: 'Garage_sm_ss1_s1->Garage_sm_ss1_s2',
      kind: 'edge',
      anchorTitle: 'From ss1.s1 to ss1.s2 on ev2',
    })

    expect(range).not.toBeNull()
    expect(nested.slice(range!.from, range!.to)).toBe('        ev2 -> s2;')
  })

  it('still selects a fully qualified destination exactly', () => {
    const range = findDiagramRange(nested, {
      name: 'Garage_sm_ss1_s2->Garage_sm_ss2_s3',
      kind: 'edge',
      anchorTitle: 'From ss1.s2 to ss2.s3 on ev3',
    })

    expect(range).not.toBeNull()
    expect(nested.slice(range!.from, range!.to)).toBe('        ev3 -> ss2.s3;')
  })

  it('selects a transition leaving one superstate for another', () => {
    const range = findDiagramRange(nested, {
      name: 'Garage_sm_ss1->Garage_sm_ss2',
      kind: 'edge',
      anchorTitle: 'From ss1 to ss2 on ev4',
    })

    expect(range).not.toBeNull()
    expect(nested.slice(range!.from, range!.to)).toBe('      ev4 -> ss2;')
  })

  // Oven*^*sm2*^*tick*^*warming.inner1.deep1*^*warming.inner1.deep2*^* [temp > 5]
  const deep = `class Oven {
  Integer temp = 0;
  sm2 {
    off {
      turnOn -> warming;
    }
    warming {
      inner1 {
        deep1 {
          tick [temp > 5] -> deep2;
        }
        deep2 {
        }
      }
      inner2 {
        [temp > 10] -> inner1.deep1;
      }
    }
  }
}
`

  it('selects across three levels of nesting from a bare destination', () => {
    const range = findDiagramRange(deep, {
      name: 'Oven_sm2_warming_inner1_deep1->Oven_sm2_warming_inner1_deep2',
      kind: 'edge',
      anchorTitle: 'From warming.inner1.deep1 to warming.inner1.deep2 on tick\nGuard: [temp > 5]',
    })

    expect(range).not.toBeNull()
    expect(deep.slice(range!.from, range!.to)).toBe('          tick [temp > 5] -> deep2;')
  })

  it('selects when the source uses a partially qualified destination', () => {
    const range = findDiagramRange(deep, {
      name: 'Oven_sm2_warming_inner2->Oven_sm2_warming_inner1_deep1',
      kind: 'edge',
      anchorTitle: 'From warming.inner2 to warming.inner1.deep1 automatically\nGuard: [temp > 10]',
    })

    expect(range).not.toBeNull()
    expect(deep.slice(range!.from, range!.to)).toBe('        [temp > 10] -> inner1.deep1;')
  })

  // Rep*^*sm*^*ev*^*ss2.s1*^*ss1.s2*^*  -- Umple binds the bare `s2` written inside
  // ss2.s1 to ss1.s2, so an abbreviated destination is NOT scoped to the enclosing
  // superstate. The source state's own block is what keeps the match unambiguous.
  const repeated = `class Rep {
  sm {
    ss1 {
      s1 {
        ev -> s2;
      }
      s2 {
        out1 -> ss2;
      }
    }
    ss2 {
      s1 {
        ev -> s2;
      }
      s2 {
      }
    }
  }
}
`

  it('selects the transition inside the clicked state when leaf names repeat', () => {
    const range = findDiagramRange(repeated, {
      name: 'Rep_sm_ss2_s1->Rep_sm_ss1_s2',
      kind: 'edge',
      anchorTitle: 'From ss2.s1 to ss1.s2 on ev',
    })

    expect(range).not.toBeNull()
    // The second `ev -> s2;`, the one declared inside ss2.s1.
    expect(range!.from).toBeGreaterThan(repeated.indexOf('ss2 {'))
    expect(repeated.slice(range!.from, range!.to)).toBe('        ev -> s2;')
  })

  it("selects the superstate's own line when a substate declares the same transition", () => {
    const code = `class Z {
  sm {
    ss1 {
      s1 {
        ev -> s1;
      }
      ev -> s1;
    }
  }
}
`
    const range = findDiagramRange(code, {
      name: 'Z_sm_ss1->Z_sm_ss1_s1',
      kind: 'edge',
      anchorTitle: 'From ss1 to ss1.s1 on ev',
    })

    // Only ss1 can own this identity, so the substate's identical line is not a
    // candidate for it and the superstate's own line resolves unambiguously.
    expect(code.slice(range!.from, range!.to)).toBe('      ev -> s1;')
    expect(range!.from).toBeGreaterThan(code.indexOf('      s1 {'))
  })

  it('tells an abbreviated destination apart from a qualified one on the same trigger', () => {
    const code = `class C {
  sm {
    ss1 {
      s1 {
        go -> s2;
        go -> ss2.s2;
      }
      s2 {
      }
    }
    ss2 {
      s2 {
      }
    }
  }
}
`
    const abbreviated = findDiagramRange(code, {
      name: 'C_sm_ss1_s1->C_sm_ss1_s2',
      kind: 'edge',
      anchorTitle: 'From ss1.s1 to ss1.s2 on go',
    })
    expect(code.slice(abbreviated!.from, abbreviated!.to)).toBe('        go -> s2;')

    const qualified = findDiagramRange(code, {
      name: 'C_sm_ss1_s1->C_sm_ss2_s2',
      kind: 'edge',
      anchorTitle: 'From ss1.s1 to ss2.s2 on go',
    })
    expect(code.slice(qualified!.from, qualified!.to)).toBe('        go -> ss2.s2;')
  })

  it('never reaches a substate-only transition from a superstate identity', () => {
    // The compiler always attributes a transition to the state that declares it --
    // `-generate GvStateDiagram` on this model emits "From ss1.s1 to ss1.s9 on ev",
    // never "From ss1 to ...". A superstate identity for a transition only its
    // substate declares therefore means the diagram predates an edit to the source,
    // which V2 can show because the previous diagram stays clickable while it
    // regenerates. The substate's line must not be claimed for it.
    const code = `class Child {
  sm {
    ss1 {
      s1 {
        ev -> s9;
      }
      s9 {
      }
    }
    ss2 {
      t1 {
      }
    }
  }
}
`
    const range = findDiagramRange(code, {
      name: 'Child_sm_ss1->Child_sm_ss1_s9',
      kind: 'edge',
      anchorTitle: 'From ss1 to ss1.s9 on ev',
    })

    expect(code.slice(range!.from, range!.to)).toBe(`    ss1 {
      s1 {
        ev -> s9;
      }
      s9 {
      }
    }`)
  })

  it('is not confused by entry and exit action braces preceding the transition', () => {
    const code = `class E {
  Integer count = 0;
  sm {
    a {
      entry / { count = 1; }
      exit / { count = 0; }
      tick -> b;
    }
    b {
    }
  }
}
`
    const range = findDiagramRange(code, {
      name: 'E_sm_a->E_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on tick',
    })

    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe('      tick -> b;')
  })

  it('does not count a brace inside a string literal when scoping declarations', () => {
    const code = `class S {
  sm {
    a {
      go [label == "{"] -> b;
    }
    b {
    }
  }
}
`
    const range = findDiagramRange(code, {
      name: 'S_sm_a->S_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on go\rGuard: [label == "{"]',
    })

    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe('      go [label == "{"] -> b;')
  })

  it('does not treat a qualified sibling destination as the abbreviated one', () => {
    const code = `class Q {
  sm {
    ss1 {
      s1 {
        ev -> ss2.s2;
      }
      s2 {
      }
    }
    ss2 {
      s2 {
      }
    }
  }
}
`
    const range = findDiagramRange(code, {
      name: 'Q_sm_ss1_s1->Q_sm_ss1_s2',
      kind: 'edge',
      anchorTitle: 'From ss1.s1 to ss1.s2 on ev',
    })

    // ss1.s1 holds no transition to ss1.s2, so the resolver must not claim the
    // `-> ss2.s2;` line. Falling back to the enclosing state block is acceptable.
    expect(code.slice(range!.from, range!.to)).toBe(`      s1 {
        ev -> ss2.s2;
      }`)
  })
})

describe('findDiagramRange — event argument formatting (G2)', () => {
  // Ovl*^*sm*^*go(String who,Integer n)*^*a*^*b*^*
  const code = `class Ovl {
  sm {
    a {
      go(String who, Integer n) -> b;
      go(Integer only) -> c;
    }
    b {
    }
    c {
    }
  }
}
`

  it('ignores the spacing Umple drops when re-printing arguments', () => {
    const range = findDiagramRange(code, {
      name: 'Ovl_sm_a->Ovl_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on go(String who,Integer n)',
    })

    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe('      go(String who, Integer n) -> b;')
  })

  it('does not select a different overload of the same event', () => {
    const range = findDiagramRange(code, {
      name: 'Ovl_sm_a->Ovl_sm_c',
      kind: 'edge',
      anchorTitle: 'From a to c on go(Integer only)',
    })

    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe('      go(Integer only) -> c;')
  })

  it('distinguishes overloads that share a destination', () => {
    const shared = `class Shared {
  sm {
    a {
      go(String who) -> b;
      go(Integer n) -> b;
    }
    b {
    }
  }
}
`
    const range = findDiagramRange(shared, {
      name: 'Shared_sm_a->Shared_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on go(Integer n)',
    })

    expect(range).not.toBeNull()
    expect(shared.slice(range!.from, range!.to)).toBe('      go(Integer n) -> b;')
  })

  it('does not match a parenthesised source trigger when the metadata has no arguments', () => {
    const bare = `class A {
  sm {
    a {
      ev(x) -> b;
    }
    b {
    }
  }
}
`
    const range = findDiagramRange(bare, {
      name: 'A_sm_a->A_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on ev',
    })

    expect(bare.slice(range!.from, range!.to)).toBe(`    a {
      ev(x) -> b;
    }`)
  })

  it('handles argument types containing regex metacharacters', () => {
    const arrays = `class D {
  sm {
    a {
      go(String[] names) -> b;
    }
    b {
    }
  }
}
`
    const range = findDiagramRange(arrays, {
      name: 'D_sm_a->D_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on go(String[] names)',
    })

    expect(range).not.toBeNull()
    expect(arrays.slice(range!.from, range!.to)).toBe('      go(String[] names) -> b;')
  })

  it('leaves an argument list broken across lines to the enclosing block', () => {
    // Argument spacing is matched with [ \t] only, so a pattern can never run past
    // its own line. A wrapped argument list therefore falls back instead of risking
    // a match that spans unrelated statements.
    const wrapped = `class B {
  sm {
    a {
      go(String who,
         Integer n) -> b;
    }
    b {
    }
  }
}
`
    const range = findDiagramRange(wrapped, {
      name: 'B_sm_a->B_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on go(String who,Integer n)',
    })

    expect(wrapped.slice(range!.from, range!.to)).toBe(`    a {
      go(String who,
         Integer n) -> b;
    }`)
  })

  it('keeps timed transitions working', () => {
    const timed = `class Timed {
  sm {
    d {
      after(7) -> a;
    }
    a {
    }
  }
}
`
    const range = findDiagramRange(timed, {
      name: 'Timed_sm_d->Timed_sm_a',
      kind: 'edge',
      anchorTitle: 'From d to a after(7)',
    })

    expect(range).not.toBeNull()
    expect(timed.slice(range!.from, range!.to)).toBe('      after(7) -> a;')
  })

  it('keeps a multi-line transition action with spaced arguments', () => {
    const multiline = `class Auction {
  status {
    created {
      listitem(double reserve,  boolean active) / {
        reservePrice = reserve;
      }
      -> listed;
    }

    listed {
    }
  }
}
`
    const range = findDiagramRange(multiline, {
      name: 'Auction_status_created->Auction_status_listed',
      kind: 'edge',
      anchorTitle: 'From created to listed on listitem(double reserve,boolean active)',
    })

    expect(range).not.toBeNull()
    expect(multiline.slice(range!.from, range!.to)).toBe(`      listitem(double reserve,  boolean active) / {
        reservePrice = reserve;
      }
      -> listed;`)
  })
})

describe('findDiagramRange — guard formatting (G3)', () => {
  // Counter*^*sm*^*tick*^*c*^*d*^* [n > 20]
  const code = `class Counter {
  Integer n = 0;
  sm {
    c {
      tick [n>1&&n<9] -> d;
      tick [n>20] -> d;
    }
    d {
    }
  }
}
`

  it('matches a guard the compiler re-spaced', () => {
    const range = findDiagramRange(code, {
      name: 'Counter_sm_c->Counter_sm_d',
      kind: 'edge',
      anchorTitle: 'From c to d on tick\nGuard: [n > 1 && n < 9]',
    })

    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe('      tick [n>1&&n<9] -> d;')
  })

  it('picks the right one of two transitions differing only by guard', () => {
    const range = findDiagramRange(code, {
      name: 'Counter_sm_c->Counter_sm_d',
      kind: 'edge',
      anchorTitle: 'From c to d on tick\nGuard: [n > 20]',
    })

    expect(range).not.toBeNull()
    expect(code.slice(range!.from, range!.to)).toBe('      tick [n>20] -> d;')
  })

  it('selects nothing specific when the metadata cannot tell two guards apart', () => {
    const range = findDiagramRange(code, {
      name: 'Counter_sm_c->Counter_sm_d',
      kind: 'edge',
      anchorTitle: 'From c to d on tick',
    })

    // Two guarded transitions fit equally well, so neither transition line may be
    // claimed; the enclosing state block is the safe answer.
    expect(code.slice(range!.from, range!.to)).toBe(`    c {
      tick [n>1&&n<9] -> d;
      tick [n>20] -> d;
    }`)
  })

  // Both tooltips below are verbatim `tooltip = "From ..."` values from Bug.gv,
  // produced by `java -jar jars/umplesync.jar -generate GvStateDiagram`. The model
  // compiles with no warnings and yields five states, so `-> ss1.s1;` and `-> s1;`
  // written in ss2.s3 resolve to the same state. `&#13;` reaches the DOM as \r.
  const mixedQualification = `class Bug {
  Integer n = 0;
  sm {
    ss1 {
      s1 {
        go -> s9;
      }
      s9 {
        back -> s3;
      }
    }
    ss2 {
      s3 {
        tick [n > 1] -> ss1.s1;
        tick [n > 2] -> s1;
      }
    }
  }
}
`

  it('prefers the matching guard over the better qualified destination', () => {
    const range = findDiagramRange(mixedQualification, {
      name: 'Bug_sm_ss2_s3->Bug_sm_ss1_s1',
      kind: 'edge',
      anchorTitle: 'From ss2.s3 to ss1.s1 on tick\rGuard:  [n > 2]',
    })

    expect(range).not.toBeNull()
    // The qualified `-> ss1.s1;` line carries the other guard, so matching the
    // destination exactly must not outrank matching the guard.
    expect(mixedQualification.slice(range!.from, range!.to)).toBe('        tick [n > 2] -> s1;')
  })

  it('still selects the qualified destination when that is the guard that matches', () => {
    const range = findDiagramRange(mixedQualification, {
      name: 'Bug_sm_ss2_s3->Bug_sm_ss1_s1',
      kind: 'edge',
      anchorTitle: 'From ss2.s3 to ss1.s1 on tick\rGuard:  [n > 1]',
    })

    expect(range).not.toBeNull()
    expect(mixedQualification.slice(range!.from, range!.to)).toBe('        tick [n > 1] -> ss1.s1;')
  })

  it('reports nothing when an unmatchable guard leaves two guarded transitions', () => {
    const range = findDiagramRange(mixedQualification, {
      name: 'Bug_sm_ss2_s3->Bug_sm_ss1_s1',
      kind: 'edge',
      // A guard the source cannot match, as a reprinted operator or stale metadata
      // would produce. Both lines carry a guard of their own, so neither may be
      // claimed just because its destination spelling is the more qualified one.
      anchorTitle: 'From ss2.s3 to ss1.s1 on tick\rGuard: [n > 99]',
    })

    expect(range!.from).toBe(mixedQualification.indexOf('      s3 {'))
    expect(mixedQualification.slice(range!.from, range!.to)).toBe(`      s3 {
        tick [n > 1] -> ss1.s1;
        tick [n > 2] -> s1;
      }`)
  })

  it('does not accept a differently guarded transition just because it is the only one', () => {
    const single = `class O {
  sm {
    ss1 {
      s1 {
        go -> s9;
      }
      s9 {
      }
    }
    ss2 {
      s3 {
        tick [n > 1] -> s1;
      }
    }
  }
}
`
    const range = findDiagramRange(single, {
      name: 'O_sm_ss2_s3->O_sm_ss1_s1',
      kind: 'edge',
      anchorTitle: 'From ss2.s3 to ss1.s1 on tick\rGuard: [n > 99]',
    })

    // The candidate carries a guard of its own that is not a reformatting of
    // [n > 99], so being the only candidate does not make it the right transition.
    expect(single.slice(range!.from, range!.to)).toBe(`      s3 {
        tick [n > 1] -> s1;
      }`)
  })

  it('still resolves a guarded transition when the metadata omits the guard', () => {
    // `-generate GvStateDiagram HG.ump -s hideguards` emits
    // `tooltip = "From a to b on tick"` with no Guard line, even though the source
    // transition is guarded. V2 reaches this through the Guards display toggle, so a
    // missing guard in the metadata must stay permissive.
    const hidden = `class HG {
  Integer n = 0;
  sm {
    a {
      tick [n > 1] -> b;
    }
    b {
    }
  }
}
`
    const range = findDiagramRange(hidden, {
      name: 'HG_sm_a->HG_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on tick',
    })

    expect(range).not.toBeNull()
    expect(hidden.slice(range!.from, range!.to)).toBe('      tick [n > 1] -> b;')
  })

  it('does not collapse whitespace inside a string literal in a guard', () => {
    const literal = `class Lit {
  sm {
    a {
      go [name == "a b"] -> b;
      go [name == "ab"] -> b;
    }
    b {
    }
  }
}
`
    const range = findDiagramRange(literal, {
      name: 'Lit_sm_a->Lit_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on go\nGuard: [name == "ab"]',
    })

    expect(range).not.toBeNull()
    expect(literal.slice(range!.from, range!.to)).toBe('      go [name == "ab"] -> b;')
  })
})

describe('findDiagramRange — automatic transitions and scan termination', () => {
  // Unindented Umple is valid: this model compiles with no diagnostics and yields
  // `Flat*^*sm*^**^*a*^*b*^*` and `Flat*^*sm*^**^*b*^*c*^*[n > 1]`. The automatic
  // transition pattern matches the indentation and then looks ahead, so with no
  // indentation it matches empty -- the scan has to step past it to terminate.
  const unindented = `class Flat {
Integer n = 0;
sm {
a {
-> b;
}
b {
[n > 1] -> c;
}
c {
tick -> a;
}
}
}
`

  it('selects an unindented automatic transition', () => {
    const range = findDiagramRange(unindented, {
      name: 'Flat_sm_a->Flat_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b automatically',
    })

    expect(range).not.toBeNull()
    expect(unindented.slice(range!.from, range!.to)).toBe('-> b;')
  })

  it('selects an unindented guarded automatic transition', () => {
    const range = findDiagramRange(unindented, {
      name: 'Flat_sm_b->Flat_sm_c',
      kind: 'edge',
      anchorTitle: 'From b to c automatically\rGuard: [n > 1]',
    })

    expect(range).not.toBeNull()
    expect(unindented.slice(range!.from, range!.to)).toBe('[n > 1] -> c;')
  })

  it('selects an unindented triggered transition', () => {
    const range = findDiagramRange(unindented, {
      name: 'Flat_sm_c->Flat_sm_a',
      kind: 'edge',
      anchorTitle: 'From c to a on tick',
    })

    expect(range).not.toBeNull()
    expect(unindented.slice(range!.from, range!.to)).toBe('tick -> a;')
  })

  it('still selects an indented automatic transition', () => {
    const indented = `class Indented {
  sm {
    a {
      -> b;
    }
    b {
    }
  }
}
`
    const range = findDiagramRange(indented, {
      name: 'Indented_sm_a->Indented_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b automatically',
    })

    expect(range).not.toBeNull()
    expect(indented.slice(range!.from, range!.to)).toBe('      -> b;')
  })

  // Tooltips from `-generate GvStateDiagram Multi.ump`: two guarded automatic
  // transitions leave the same unindented state, so the scan has to reach past the
  // first zero-length match to find the second.
  const several = `class Multi {
Integer n = 0;
sm {
a {
[n > 1] -> b;
[n > 5] -> c;
}
b {
back -> a;
}
c {
back -> a;
}
}
}
`

  // Resolving both proves the scan advances past the first zero-length match rather
  // than repeating it: a repeat would offer one statement twice and the ambiguity
  // rule would refuse to resolve it, while failing to advance would hide the second.
  it('distinguishes several automatic transitions leaving the same state', () => {
    const first = findDiagramRange(several, {
      name: 'Multi_sm_a->Multi_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b automatically\rGuard: [n > 1]',
    })
    expect(several.slice(first!.from, first!.to)).toBe('[n > 1] -> b;')

    const second = findDiagramRange(several, {
      name: 'Multi_sm_a->Multi_sm_c',
      kind: 'edge',
      anchorTitle: 'From a to c automatically\rGuard: [n > 5]',
    })
    expect(several.slice(second!.from, second!.to)).toBe('[n > 5] -> c;')
  })
})

describe('findDiagramRange — guards are read from the guard, not the action (G3)', () => {
  // `-generate GvStateDiagram Example.ump` emits
  // `tooltip = "From a to b on tick&#13;Guard:  [n > 1]&#13;Transition Action:…"`.
  // The action prints the text "[n > 2]", which must not pass for a guard.
  const literalInAction = `class Example {
  Integer n = 0;

  sm {
    a {
      tick [n > 1] / {
        System.out.println("[n > 2]");
      } -> b;
    }
    b {
    }
  }
}
`

  it('does not accept a guard that only appears inside the transition action', () => {
    const range = findDiagramRange(literalInAction, {
      name: 'Example_sm_a->Example_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on tick\rGuard:  [n > 2]',
    })

    expect(range!.from).toBe(literalInAction.indexOf('    a {'))
    expect(literalInAction.slice(range!.from, range!.to)).toBe(`    a {
      tick [n > 1] / {
        System.out.println("[n > 2]");
      } -> b;
    }`)
  })

  it('still selects the transition for its own guard when it carries an action', () => {
    const range = findDiagramRange(literalInAction, {
      name: 'Example_sm_a->Example_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on tick\rGuard:  [n > 1]',
    })

    expect(range).not.toBeNull()
    expect(literalInAction.slice(range!.from, range!.to)).toBe(`      tick [n > 1] / {
        System.out.println("[n > 2]");
      } -> b;`)
  })

  // Two.ump: both transitions share trigger and destination, and the first one's
  // action prints the second one's guard. Tooltips are `Guard:  [n > 1]` and
  // `Guard:  [n > 5]`.
  const actionQuotesOtherGuard = `class Two {
  Integer n = 0;
  sm {
    a {
      tick [n > 1] / {
        System.out.println("[n > 5]");
      } -> b;
      tick [n > 5] -> b;
    }
    b {
    }
  }
}
`

  it('selects the transition whose own guard matches, not the one quoting it', () => {
    const range = findDiagramRange(actionQuotesOtherGuard, {
      name: 'Two_sm_a->Two_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on tick\rGuard:  [n > 5]',
    })

    expect(range).not.toBeNull()
    expect(actionQuotesOtherGuard.slice(range!.from, range!.to)).toBe('      tick [n > 5] -> b;')
  })

  it('selects the acting transition for its own guard', () => {
    const range = findDiagramRange(actionQuotesOtherGuard, {
      name: 'Two_sm_a->Two_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on tick\rGuard:  [n > 1]',
    })

    expect(range).not.toBeNull()
    expect(actionQuotesOtherGuard.slice(range!.from, range!.to)).toBe(`      tick [n > 1] / {
        System.out.println("[n > 5]");
      } -> b;`)
  })

  it('does not mistake a bracket in the event arguments for the guard', () => {
    // Arr2.ump tooltip: `From a to b on go(String [] names)` with `Guard:  [n > 1]`.
    const arrayArgument = `class Arr2 {
  Integer n = 0;
  sm {
    a {
      go(String [] names) [n > 1] -> b;
    }
    b {
    }
  }
}
`
    const range = findDiagramRange(arrayArgument, {
      name: 'Arr2_sm_a->Arr2_sm_b',
      kind: 'edge',
      anchorTitle: 'From a to b on go(String [] names)\rGuard:  [n > 1]',
    })

    expect(range).not.toBeNull()
    expect(arrayArgument.slice(range!.from, range!.to)).toBe('      go(String [] names) [n > 1] -> b;')
  })

  it('reports nothing when hidden guards leave two differently spelled destinations', () => {
    // With the hideGuards suboption the tooltip carries no Guard line, so these two
    // transitions share source, event and destination and differ only by a guard the
    // metadata does not show. The destination spelling must not choose between them.
    const hiddenGuards = `class Hidden {
  Integer n = 0;
  sm {
    ss1 {
      s1 {
        go -> s9;
      }
      s9 {
      }
    }
    ss2 {
      s3 {
        tick [n > 1] -> ss1.s1;
        tick [n > 5] -> s1;
      }
    }
  }
}
`
    const range = findDiagramRange(hiddenGuards, {
      name: 'Hidden_sm_ss2_s3->Hidden_sm_ss1_s1',
      kind: 'edge',
      anchorTitle: 'From ss2.s3 to ss1.s1 on tick',
    })

    expect(hiddenGuards.slice(range!.from, range!.to)).toBe(`      s3 {
        tick [n > 1] -> ss1.s1;
        tick [n > 5] -> s1;
      }`)
  })
})
