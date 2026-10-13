// Package crud turns the compiler's model.json into the schema the object explorer edits.
// handlers/crud_schema.go calls into this package after a compile. The browser never sees the raw compiler JSON.
package crud

// The helpers here parse model.json and flatten inheritance, associations, and enums into that schema.

import (
	"encoding/json"
	"strconv"
	"strings"
)

// FlexBool handles JSON values that may be a boolean or a string ("true"/"false").
// The Umple compiler emits isAbstract as a string, not a native boolean.
type FlexBool bool

func (fb *FlexBool) UnmarshalJSON(data []byte) error {
	var b bool
	if err := json.Unmarshal(data, &b); err == nil {
		*fb = FlexBool(b)
		return nil
	}
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		*fb = FlexBool(s == "true")
		return nil
	}
	*fb = false
	return nil
}

// RawModel is the top-level structure of model.json produced by the Umple compiler.
type RawModel struct {
	UmpleClasses      []RawClass              `json:"umpleClasses"`
	UmpleAssociations []RawAssociation        `json:"umpleAssociations"`
	UmpleInterfaces   []RawInterface          `json:"umpleInterfaces"`
	GlobalEnums       []map[string][]string   `json:"globalEnums"`
}

type RawClass struct {
	Name                  string                  `json:"name"`
	Attributes            []RawAttribute          `json:"attributes"`
	Methods               []RawMethod             `json:"methods"`
	IsAbstract            FlexBool                `json:"isAbstract"`
	ExtendsClass          string                  `json:"extendsClass"`
	ImplementedInterfaces []string                `json:"implementedInterfaces"`
	Enums                 []map[string][]string   `json:"enums"`
}

type RawAttribute struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	Value string `json:"value"`
}

type RawMethod struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Parameters string `json:"parameters"`
	Visibility string `json:"visibility"`
}

type RawAssociation struct {
	ClassOneID           string `json:"classOneId"`
	ClassTwoID           string `json:"classTwoId"`
	MultiplicityOne      string `json:"multiplicityOne"`
	MultiplicityTwo      string `json:"multiplicityTwo"`
	RoleOne              string `json:"roleOne"`
	RoleTwo              string `json:"roleTwo"`
	IsLeftNavigable      string `json:"isLeftNavigable"`
	IsRightNavigable     string `json:"isRightNavigable"`
	IsLeftComposition    string `json:"isLeftComposition"`
	IsRightComposition   string `json:"isRightComposition"`
	IsSymmetricReflexive string `json:"isSymmetricReflexive"`
}

type RawInterface struct {
	Name              string      `json:"name"`
	Methods           []RawMethod `json:"methods"`
	ExtendsInterfaces []string    `json:"extendsInterfaces"`
}

// CrudSchema is the frontend-ready CRUD schema returned by the API.
type CrudSchema struct {
	Classes []CrudClass `json:"classes"`
	Enums   []CrudEnum  `json:"enums"`
}

type CrudClass struct {
	Name         string            `json:"name"`
	IsAbstract   bool              `json:"isAbstract"`
	ExtendsClass string            `json:"extendsClass,omitempty"`
	Attributes   []CrudAttribute   `json:"attributes"`
	Associations []CrudAssociation `json:"associations"`
}

type CrudAttribute struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	TypeKind    string `json:"typeKind"` // "primitive", "enum", "class"
	IsInherited bool   `json:"isInherited"`
	InheritedFrom string `json:"inheritedFrom,omitempty"`
}

type CrudAssociation struct {
	TargetClass     string       `json:"targetClass"`
	RoleName        string       `json:"roleName"`
	ReverseRoleName string       `json:"reverseRoleName"`
	Multiplicity    Multiplicity `json:"multiplicity"`
	IsNavigable     bool         `json:"isNavigable"`
	IsComposition   bool         `json:"isComposition"`
	IsReflexive     bool         `json:"isReflexive,omitempty"`
}

type Multiplicity struct {
	Min int    `json:"min"`
	Max int    `json:"max"` // -1 means unbounded (*)
	Raw string `json:"raw"`
}

type CrudEnum struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

// ParseMultiplicity converts a multiplicity string like "0..1", "*", "1..*"
// into a structured Multiplicity. Max of -1 means unbounded.
func ParseMultiplicity(raw string) Multiplicity {
	s := strings.TrimSpace(raw)
	result := Multiplicity{Raw: raw}

	if s == "" || s == "*" {
		result.Max = -1
		return result
	}

	if !strings.Contains(s, "..") {
		n, err := strconv.Atoi(s)
		if err != nil {
			result.Max = -1
			return result
		}
		result.Min = n
		result.Max = n
		return result
	}

	parts := strings.SplitN(s, "..", 2)
	if min, err := strconv.Atoi(parts[0]); err == nil {
		result.Min = min
	}
	if parts[1] == "*" {
		result.Max = -1
	} else if max, err := strconv.Atoi(parts[1]); err == nil {
		result.Max = max
	} else {
		result.Max = -1
	}
	return result
}

// ClassifyType returns "primitive", "enum", or "class" for a given type name.
func ClassifyType(typeName string, classNames, enumNames map[string]bool) string {
	if enumNames[typeName] {
		return "enum"
	}
	if classNames[typeName] {
		return "class"
	}
	return "primitive"
}

// BuildInheritanceChain walks from className up through extendsClass pointers,
// returning the chain from the class itself to the root ancestor.
// Handles circular references by tracking visited classes.
func BuildInheritanceChain(className string, classByName map[string]*RawClass) []*RawClass {
	var chain []*RawClass
	visited := map[string]bool{}

	for current := className; current != ""; {
		if visited[current] {
			break
		}
		cls, ok := classByName[current]
		if !ok {
			break
		}
		visited[current] = true
		chain = append(chain, cls)
		current = cls.ExtendsClass
	}
	return chain
}

// FlattenAttributes returns own attributes first, then inherited attributes
// walking up the inheritance chain (nearest parent first).
func FlattenAttributes(className string, classByName map[string]*RawClass, classNames, enumNames map[string]bool) []CrudAttribute {
	chain := BuildInheritanceChain(className, classByName)
	var result []CrudAttribute

	for i, cls := range chain {
		isInherited := i > 0
		for _, attr := range cls.Attributes {
			ca := CrudAttribute{
				Name:     attr.Name,
				Type:     attr.Type,
				TypeKind: ClassifyType(attr.Type, classNames, enumNames),
			}
			if isInherited {
				ca.IsInherited = true
				ca.InheritedFrom = cls.Name
			}
			result = append(result, ca)
		}
	}
	return result
}

// ResolveAssociations returns all associations for className, viewed from that
// class's perspective. For self-referencing associations, two entries are
// returned (one per end).
func ResolveAssociations(className string, associations []RawAssociation) []CrudAssociation {
	var result []CrudAssociation

	for _, a := range associations {
		isClassOne := a.ClassOneID == className
		isClassTwo := a.ClassTwoID == className

		if !isClassOne && !isClassTwo {
			continue
		}

		isReflexive := a.ClassOneID == a.ClassTwoID

		// When class appears as classOne, the target is classTwo
		if isClassOne {
			result = append(result, CrudAssociation{
				TargetClass:     a.ClassTwoID,
				RoleName:        a.RoleTwo,
				ReverseRoleName: a.RoleOne,
				Multiplicity:    ParseMultiplicity(a.MultiplicityTwo),
				IsNavigable:     a.IsRightNavigable == "true",
				IsComposition:   a.IsRightComposition == "true",
				IsReflexive:     isReflexive,
			})
		}

		// When class appears as classTwo, the target is classOne
		if isClassTwo {
			result = append(result, CrudAssociation{
				TargetClass:     a.ClassOneID,
				RoleName:        a.RoleOne,
				ReverseRoleName: a.RoleTwo,
				Multiplicity:    ParseMultiplicity(a.MultiplicityOne),
				IsNavigable:     a.IsLeftNavigable == "true",
				IsComposition:   a.IsLeftComposition == "true",
				IsReflexive:     isReflexive,
			})
		}
	}
	return result
}

// ExtractEnums collects enum definitions from global enums and class-local enums.
// Returns the list of CrudEnums and a set of enum names for type classification.
func ExtractEnums(model RawModel) ([]CrudEnum, map[string]bool) {
	enumNames := map[string]bool{}
	var enums []CrudEnum

	for _, enumMap := range model.GlobalEnums {
		for name, values := range enumMap {
			if !enumNames[name] {
				enumNames[name] = true
				enums = append(enums, CrudEnum{Name: name, Values: values})
			}
		}
	}

	for _, cls := range model.UmpleClasses {
		for _, enumMap := range cls.Enums {
			for name, values := range enumMap {
				if !enumNames[name] {
					enumNames[name] = true
					enums = append(enums, CrudEnum{Name: name, Values: values})
				}
			}
		}
	}

	return enums, enumNames
}

// TransformSchema converts a raw compiler model into a frontend-ready CrudSchema.
func TransformSchema(raw RawModel) CrudSchema {
	enums, enumNames := ExtractEnums(raw)

	// Build lookup maps
	classByName := make(map[string]*RawClass, len(raw.UmpleClasses))
	classNames := make(map[string]bool, len(raw.UmpleClasses))
	for i := range raw.UmpleClasses {
		cls := &raw.UmpleClasses[i]
		classByName[cls.Name] = cls
		classNames[cls.Name] = true
	}

	classes := make([]CrudClass, 0, len(raw.UmpleClasses))
	for _, cls := range raw.UmpleClasses {
		attrs := FlattenAttributes(cls.Name, classByName, classNames, enumNames)
		assocs := ResolveAssociations(cls.Name, raw.UmpleAssociations)

		if attrs == nil {
			attrs = []CrudAttribute{}
		}
		if assocs == nil {
			assocs = []CrudAssociation{}
		}

		classes = append(classes, CrudClass{
			Name:         cls.Name,
			IsAbstract:   bool(cls.IsAbstract),
			ExtendsClass: cls.ExtendsClass,
			Attributes:   attrs,
			Associations: assocs,
		})
	}

	if enums == nil {
		enums = []CrudEnum{}
	}

	return CrudSchema{
		Classes: classes,
		Enums:   enums,
	}
}
