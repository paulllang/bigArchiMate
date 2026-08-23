import {
   ARCHIMATE_ELEMENT_TYPE_MAP,
   ARCHIMATE_NODE_TYPE_MAP,
   ARCHIMATE_RELATION_TYPE_MAP,
   ConceptType,
   ElementType,
   elementTypes,
   getLabel,
   getLayer,
   isRelationType,
   junctionTypes,
   LayerType,
   relationTypes
} from '@big-archimate/protocol';
import { ElementTypeEntry, ElementTypes, ElementTypesProvider } from '@eclipse-glsp/server-mcp';
import { injectable } from 'inversify';

/**
 * These descriptions are mostly taken from the ArchiMate 3.2 standard specification.
 */
const conceptDescriptionMap: Record<ConceptType, string> = {
   /**
    * Elements
    */

   ApplicationCollaboration:
      'An aggregate of two or more application internal active structure elements, that work together to perform collective application behavior.',
   ApplicationComponent:
      'An encapsulation of application functionality aligned to implementation structure, which is modular and replaceable.',
   ApplicationEvent: 'An application state change.',
   ApplicationFunction: 'Automated behavior that can be performed by an application component.',
   ApplicationInteraction:
      'A unit of collective application behavior performed by (a collaboration of) two or more application components.',
   ApplicationInterface:
      'A point of access where application services are made available to a user, another application component, or a node.',
   ApplicationProcess: 'A sequence of application behaviors that achieves a specific result.',
   ApplicationService: 'An explicitly defined exposed application behavior.',
   Artifact: 'A piece of data that is used or produced in a software development process, or by deployment and operation of an IT system.',
   Assessment: 'The result of an analysis of the state of affairs of the enterprise with respect to some driver.',
   BusinessActor: 'A business entity that is capable of performing behavior',
   BusinessCollaboration:
      'An aggregate of two or more business internal active structure elements that work together to perform collective behavior.',
   BusinessEvent: 'A business-related state change.',
   BusinessFunction:
      'A collection of business behavior based on a chosen set of criteria such as required business resources and/or competencies, and is managed or performed as a whole.',
   BusinessInteraction:
      'A unit of collective business behavior performed by (a collaboration of) two or more business actors, business roles, or business collaborations.',
   BusinessInterface: 'A point of access where business services are made available to the environment.',
   BusinessObject: 'A concept used within a particular business domain.',
   BusinessProcess:
      'A sequence of business behaviors that achieves a specific result such as a defined set of products or business services.',
   BusinessRole:
      'The responsibility for performing specific behavior, to which an actor can be assigned, or the part an actor plays in a particular action or event.',
   BusinessService:
      'Explicitly defined behavior that a business role, business actor, or business collaboration exposes to its environment.',
   Capability: 'An ability that an active structure element, such as an organization, person, or system, possesses.',
   CommunicationNetwork: 'A set of structures that connects devices or system software for transmission, routing, and reception of data.',
   Constraint: 'A limitation on aspects of the architecture, its implementation process, or its realization.',
   Contract:
      'A formal or informal specification of an agreement between a provider and a consumer that specifies the rights and obligations associated with a product and establishes functional and non-functional parameters for interaction.',
   CourseOfAction: 'An approach or plan for configuring some capabilities and resources of the enterprise, undertaken to achieve a goal.',
   DataObject: 'Data structured for automated processing.',
   Deliverable: 'A precisely defined result of a work package.',
   Device: 'A physical IT resource upon which system software and artifacts may be stored or deployed for execution.',
   DistributionNetwork: 'A physical network used to transport materials or energy.',
   Driver:
      'An external or internal condition that motivates an organization to define its goals and implement the changes necessary to achieve them.',
   Equipment: 'One or more physical machines, tools, or instruments that can create, use, store, move, or transform materials.',
   Facility: 'A physical structure or environment.',
   Gap: 'A statement of difference between two plateaus.',
   Goal: 'A high-level statement of intent, direction, or desired end state for an organization and its stakeholders.',
   Grouping: 'Aggregates or composes concepts that belong together based on some common characteristic.',
   ImplementationEvent: 'A state change related to implementation or migration.',
   Location:
      'A conceptual or physical place or position where concepts are located (e.g., structure elements) or performed (e.g., behavior elements).',
   Material: 'Tangible physical matter or energy.',
   Meaning: 'The knowledge or expertise present in, or the interpretation given to, a concept in a particular context.',
   Node: 'A computational or physical resource that hosts, manipulates, or interacts with other computational or physical resources.',
   Outcome: 'An end result, effect, or consequence of a certain state of affairs.',
   Path: 'A link between two or more technology internal active structure elements, through which these elements can exchange data, energy, or material.',
   Plateau: 'A relatively stable state of the architecture that exists during a limited period of time.',
   Principle: 'A statement of intent defining a general property that applies to any system in a certain context in the architecture.',
   Product:
      'A coherent collection of services and/or passive structure elements, accompanied by a contract, which is offered as a whole to (internal or external) customers.',
   Representation: 'A perceptible form of the information carried by a business object.',
   Requirement: 'A statement of need defining a property that applies to a specific system as described by the architecture.',
   Resource: 'An asset owned or controlled by an individual or organization.',
   Stakeholder:
      'The role of an individual, team, or organization (or classes thereof) that represents their interests in the effects of the architecture.',
   SystemSoftware:
      'Software that provides or contributes to an environment for storing, executing, and using software or data deployed within it.',
   TechnologyCollaboration:
      'An aggregate of two or more technology internal active structure elements that work together to perform collective technology behavior.',
   TechnologyEvent: 'A technology state change.',
   TechnologyFunction: 'A collection of technology behavior that can be performed by a technology internal active structure element.',
   TechnologyInteraction:
      'A unit of collective technology behavior performed by (a collaboration of) two or more technology internal active structure elements.',
   TechnologyInterface: 'A point of access where technology services offered by a technology internal active structure can be accessed.',
   TechnologyProcess: 'A sequence of technology behaviors that achieves a specific result.',
   TechnologyService: 'An explicitly defined exposed technology behavior.',
   Value: 'The relative worth, utility, or importance of a concept.',
   ValueStream: 'A sequence of activities that create an overall result for a customer, stakeholder, or end user.',
   WorkPackage: 'A series of actions identified and designed to achieve specific results within specified time and resource constraints.',

   /**
    * Relations
    */

   Access: 'Represents the ability of behavior and active structure elements to observe or act upon passive structure elements.',
   Aggregation: 'Represents that an element combines one or more other concepts.',
   Assignment: 'Represents the allocation of responsibility, performance of behavior, storage, or execution.',
   Association: 'Represents an unspecified relationship, or one that is not represented by another ArchiMate relationship.',
   Composition: 'Represents that an element consists of one or more other concepts.',
   Flow: 'Represents transfer from one element to another.',
   Influence: 'Represents that an element affects the implementation or achievement of some motivation element.',
   Realization:
      'Represents that an element plays a critical role in the creation, achievement, sustenance, or operation of a more abstract element.',
   Serving: 'Represents that an element provides its functionality to another element.',
   Specialization: 'Represents that an element is a particular kind of another element.',
   Triggering: 'Represents a temporal or causal relationship between elements.',

   /**
    * Junctions
    */

   And: 'Used to connect relationships of the same type with a logical AND (i.e., used to explicitly express that all elements together must participate in the relationship.)',
   Or: 'Used to connect relationships of the same type with a logical OR or XOR (i.e., used to explicitly express that at least one of the elements participates in the relationship.)'
};

/**
 * Augment ElementTypeEntry with custom property layer
 */
declare module '@eclipse-glsp/server-mcp' {
   interface ElementTypeEntry {
      layer?: LayerType;
   }
}

const toEntry = (concept: ConceptType, glspType: string): ElementTypeEntry => {
   // Only elements accept text (= have a label)
   const acceptsText: boolean = ARCHIMATE_ELEMENT_TYPE_MAP.get(concept as ElementType) === undefined ? false : true;

   let layer = undefined;
   if (!isRelationType(concept)) {
      layer = getLayer(concept);
   }

   return {
      id: glspType,
      label: getLabel(concept),
      layer: layer,
      description: conceptDescriptionMap[concept],
      acceptsText: acceptsText
   };
};

@injectable()
export class ArchiMateElementTypesProvider implements ElementTypesProvider {
   get(): ElementTypes {
      const nodeTypes: ElementTypeEntry[] = [
         ...elementTypes.map(concept => toEntry(concept, ARCHIMATE_NODE_TYPE_MAP.get(concept))),
         ...junctionTypes.map(concept => toEntry(concept, ARCHIMATE_NODE_TYPE_MAP.get(concept)))
      ];
      const edgeTypes: ElementTypeEntry[] = relationTypes.map(concept => toEntry(concept, ARCHIMATE_RELATION_TYPE_MAP.get(concept)));
      return { nodeTypes, edgeTypes };
   }
}
